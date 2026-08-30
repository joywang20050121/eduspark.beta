import {strict as assert} from "node:assert";
import {after, before, describe, test} from "node:test";
import {
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {deleteApp, FirebaseApp, initializeApp} from "firebase/app";
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import {getAuth as getAdminAuth} from "firebase-admin/auth";
import {
  Auth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {doc, getDoc, setDoc, Timestamp} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

type TestClient = {
  app: FirebaseApp;
  auth: Auth;
  saveProfile: ReturnType<typeof httpsCallable>;
  redeemQr: ReturnType<typeof httpsCallable>;
  redeemReward: ReturnType<typeof httpsCallable>;
  createQrCampaign: ReturnType<typeof httpsCallable>;
  listQrCampaigns: ReturnType<typeof httpsCallable>;
  setQrCampaignStatus: ReturnType<typeof httpsCallable>;
};

let testEnvironment: RulesTestEnvironment;
const clients: TestClient[] = [];
const adminApp = initializeAdminApp({projectId: "demo-eduspark"}, "integration-tests");

async function createClient(name: string, isAdmin = false): Promise<TestClient> {
  const app = initializeApp({
    apiKey: "demo-key",
    projectId: "demo-eduspark",
    authDomain: "demo-eduspark.firebaseapp.com",
  }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
  const functions = getFunctions(app, "asia-east1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await createUserWithEmailAndPassword(auth, `${name}@example.com`, "testing1234");
  if (isAdmin) {
    await getAdminAuth(adminApp).setCustomUserClaims(auth.currentUser!.uid, {admin: true});
    await auth.currentUser!.getIdToken(true);
  }
  const client = {
    app,
    auth,
    saveProfile: httpsCallable(functions, "saveProfile"),
    redeemQr: httpsCallable(functions, "redeemQr"),
    redeemReward: httpsCallable(functions, "redeemReward"),
    createQrCampaign: httpsCallable(functions, "createQrCampaign"),
    listQrCampaigns: httpsCallable(functions, "listQrCampaigns"),
    setQrCampaignStatus: httpsCallable(functions, "setQrCampaignStatus"),
  };
  clients.push(client);
  return client;
}

async function seedCampaign(campaignId: string, points = 5) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `qrCampaigns/${campaignId}`), {
      title: "整合測試活動",
      points,
      active: true,
      startsAt: Timestamp.fromMillis(Date.now() - 60_000),
      endsAt: Timestamp.fromMillis(Date.now() + 60_000),
      createdAt: Timestamp.now(),
    });
  });
}

before(async () => {
  testEnvironment = await initializeTestEnvironment({projectId: "demo-eduspark"});
  await testEnvironment.clearFirestore();
});

after(async () => {
  await Promise.all(clients.map((client) => deleteApp(client.app)));
  await deleteAdminApp(adminApp);
  await testEnvironment.cleanup();
});

describe("QR code 交易", () => {
  test("同一帳號只能成功兌換一次", async () => {
    const client = await createClient("alice");
    await client.saveProfile({realName: "王小花", nickname: "Alice", dept: "教院", bio: "", avatar: ""});
    const campaignId = "a".repeat(36);
    await seedCampaign(campaignId);

    const first = await client.redeemQr({campaignId});
    assert.equal((first.data as {points: number}).points, 5);
    await assert.rejects(() => client.redeemQr({campaignId}), (error: {code?: string}) => {
      return error.code === "functions/already-exists";
    });
  });

  test("同時送出多次請求仍只有一筆成功", async () => {
    const client = await createClient("bob");
    await client.saveProfile({realName: "陳小明", nickname: "Bob", dept: "教院", bio: "", avatar: ""});
    const campaignId = "b".repeat(36);
    await seedCampaign(campaignId, 3);

    const results = await Promise.allSettled(
      Array.from({length: 12}, () => client.redeemQr({campaignId})),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);

    const database = testEnvironment.authenticatedContext(client.auth.currentUser!.uid).firestore();
    const profile = await assertSucceeds(getDoc(doc(database, `users/${client.auth.currentUser!.uid}`)));
    assert.equal(profile.data()?.points, 3);
    assert.equal(profile.data()?.totalPoints, 3);
  });
});

describe("獎勵兌換交易", () => {
  test("積分不足時不會產生負數", async () => {
    const client = await createClient("carol");
    await client.saveProfile({realName: "林小火", nickname: "Carol", dept: "教院", bio: "", avatar: ""});
    const results = await Promise.allSettled([
      client.redeemReward({rewardId: "starbucks"}),
      client.redeemReward({rewardId: "starbucks"}),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 0);
    const database = testEnvironment.authenticatedContext(client.auth.currentUser!.uid).firestore();
    const profile = await assertSucceeds(getDoc(doc(database, `users/${client.auth.currentUser!.uid}`)));
    assert.equal(profile.data()?.points, 0);
  });
});

describe("管理員 QR code 管理", () => {
  test("一般使用者無法建立活動", async () => {
    const client = await createClient("david");
    await assert.rejects(() => client.createQrCampaign({
      title: "不應建立的活動",
      points: 5,
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 60_000,
    }), (error: {code?: string}) => error.code === "functions/permission-denied");
  });

  test("管理員可以建立、查詢並停用活動", async () => {
    const client = await createClient("erin", true);
    const created = await client.createQrCampaign({
      title: "管理員整合測試",
      points: 8,
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 60_000,
    });
    const campaign = created.data as {id: string; url: string; svg: string; active: boolean};
    assert.match(campaign.id, /^[a-f0-9]{36}$/);
    assert.match(campaign.url, new RegExp(`redeem=${campaign.id}`));
    assert.match(campaign.svg, /<svg/);
    assert.equal(campaign.active, true);

    const listed = await client.listQrCampaigns();
    assert.ok((listed.data as Array<{id: string}>).some((item) => item.id === campaign.id));

    const disabled = await client.setQrCampaignStatus({campaignId: campaign.id, active: false});
    assert.deepEqual(disabled.data, {id: campaign.id, active: false});
  });
});
