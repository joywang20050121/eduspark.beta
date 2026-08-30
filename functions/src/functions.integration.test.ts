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
  lookupAdminUser: ReturnType<typeof httpsCallable>;
  listAdminUsers: ReturnType<typeof httpsCallable>;
  listUsers: ReturnType<typeof httpsCallable>;
  setAdminRole: ReturnType<typeof httpsCallable>;
  bootstrapSuperAdmin: ReturnType<typeof httpsCallable>;
};

let testEnvironment: RulesTestEnvironment;
const clients: TestClient[] = [];
const adminApp = initializeAdminApp({projectId: "demo-eduspark"}, "integration-tests");

async function createClient(name: string, isAdmin = false, isSuperAdmin = false): Promise<TestClient> {
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
  if (isAdmin || isSuperAdmin) {
    await getAdminAuth(adminApp).setCustomUserClaims(auth.currentUser!.uid, {
      admin: isAdmin,
      superAdmin: isSuperAdmin,
    });
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
    lookupAdminUser: httpsCallable(functions, "lookupAdminUser"),
    listAdminUsers: httpsCallable(functions, "listAdminUsers"),
    listUsers: httpsCallable(functions, "listUsers"),
    setAdminRole: httpsCallable(functions, "setAdminRole"),
    bootstrapSuperAdmin: httpsCallable(functions, "bootstrapSuperAdmin"),
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

describe("管理員權限管理", () => {
  test("只有設定且已驗證的帳號能初始化第一位管理員", async () => {
    const regular = await createClient("kate");
    await assert.rejects(() => regular.bootstrapSuperAdmin(),
      (error: {code?: string}) => error.code === "functions/permission-denied");

    const bootstrap = await createClient("bootstrap");
    await getAdminAuth(adminApp).updateUser(bootstrap.auth.currentUser!.uid, {
      emailVerified: true,
    });
    await bootstrap.auth.currentUser!.getIdToken(true);
    const result = await bootstrap.bootstrapSuperAdmin();
    assert.deepEqual(result.data, {isAdmin: true, isSuperAdmin: true});
    await bootstrap.auth.currentUser!.getIdToken(true);

    const campaign = await bootstrap.createQrCampaign({
      title: "初始化後可管理活動",
      points: 1,
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 60_000,
    });
    assert.ok((campaign.data as {id?: string}).id);
  });

  test("管理員可以授予其他人管理員權限", async () => {
    const target = await createClient("frank");
    const admin = await createClient("grace", true);
    const result = await admin.setAdminRole({
      email: target.auth.currentUser!.email,
      admin: true,
    });
    assert.equal((result.data as {isAdmin: boolean}).isAdmin, true);
    const users = await admin.listUsers();
    assert.ok((users.data as Array<{email: string}>).some((user) =>
      user.email === target.auth.currentUser!.email));
  });

  test("管理員可以查詢、授權與撤銷管理員", async () => {
    const target = await createClient("heidi");
    const superAdmin = await createClient("ivan", true, true);
    const email = target.auth.currentUser!.email!;

    const initial = await superAdmin.lookupAdminUser({email});
    assert.equal((initial.data as {isAdmin: boolean}).isAdmin, false);

    const granted = await superAdmin.setAdminRole({email, admin: true});
    assert.equal((granted.data as {isAdmin: boolean}).isAdmin, true);
    await target.auth.currentUser!.getIdToken(true);

    const listed = await superAdmin.listAdminUsers();
    assert.ok((listed.data as Array<{email: string}>).some((user) => user.email === email));

    const revoked = await superAdmin.setAdminRole({email, admin: false});
    assert.equal((revoked.data as {isAdmin: boolean}).isAdmin, false);
    await target.auth.currentUser!.getIdToken(true);
    await assert.rejects(() => target.createQrCampaign({
      title: "撤權後不可建立",
      points: 1,
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 60_000,
    }), (error: {code?: string}) => error.code === "functions/permission-denied");
  });

  test("初始保護帳號不能從介面撤銷自己", async () => {
    const superAdmin = await createClient("judy", true, true);
    await assert.rejects(() => superAdmin.setAdminRole({
      email: superAdmin.auth.currentUser!.email,
      admin: false,
    }), (error: {code?: string}) => error.code === "functions/failed-precondition");
  });
});
