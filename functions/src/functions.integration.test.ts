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
  listPublicQrCampaigns: ReturnType<typeof httpsCallable>;
  setQrCampaignStatus: ReturnType<typeof httpsCallable>;
  lookupAdminUser: ReturnType<typeof httpsCallable>;
  listAdminUsers: ReturnType<typeof httpsCallable>;
  listUsers: ReturnType<typeof httpsCallable>;
  setAdminRole: ReturnType<typeof httpsCallable>;
  bootstrapSuperAdmin: ReturnType<typeof httpsCallable>;
  createWish: ReturnType<typeof httpsCallable>;
  listWishes: ReturnType<typeof httpsCallable>;
  deleteWish: ReturnType<typeof httpsCallable>;
  listPublishedAnnouncements: ReturnType<typeof httpsCallable>;
  listAnnouncements: ReturnType<typeof httpsCallable>;
  saveAnnouncement: ReturnType<typeof httpsCallable>;
  deleteAnnouncement: ReturnType<typeof httpsCallable>;
  batchAddPoints: ReturnType<typeof httpsCallable>;
  getPointHistory: ReturnType<typeof httpsCallable>;
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
    listPublicQrCampaigns: httpsCallable(functions, "listPublicQrCampaigns"),
    setQrCampaignStatus: httpsCallable(functions, "setQrCampaignStatus"),
    lookupAdminUser: httpsCallable(functions, "lookupAdminUser"),
    listAdminUsers: httpsCallable(functions, "listAdminUsers"),
    listUsers: httpsCallable(functions, "listUsers"),
    setAdminRole: httpsCallable(functions, "setAdminRole"),
    bootstrapSuperAdmin: httpsCallable(functions, "bootstrapSuperAdmin"),
    createWish: httpsCallable(functions, "createWish"),
    listWishes: httpsCallable(functions, "listWishes"),
    deleteWish: httpsCallable(functions, "deleteWish"),
    listPublishedAnnouncements: httpsCallable(functions, "listPublishedAnnouncements"),
    listAnnouncements: httpsCallable(functions, "listAnnouncements"),
    saveAnnouncement: httpsCallable(functions, "saveAnnouncement"),
    deleteAnnouncement: httpsCallable(functions, "deleteAnnouncement"),
    batchAddPoints: httpsCallable(functions, "batchAddPoints"),
    getPointHistory: httpsCallable(functions, "getPointHistory"),
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
    const history = (await client.getPointHistory()).data as Array<{delta: number; type: string}>;
    assert.equal(history[0]?.delta, 5);
    assert.equal(history[0]?.type, "qr");
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

describe("許願池", () => {
  test("使用者可以公開或匿名留言，管理員可以刪除", async () => {
    const named = await createClient("wish-named");
    const anonymous = await createClient("wish-anonymous");
    const admin = await createClient("wish-admin", true);

    const namedWish = await named.createWish({message: "希望多辦交流活動", anonymous: false, category: "suggestion"});
    const anonymousWish = await anonymous.createWish({message: "這是一則匿名建議", anonymous: true, category: "curiosity"});
    const wishes = (await named.listWishes()).data as Array<{
      id: string;
      message: string;
      authorName: string;
      anonymous: boolean;
      category: string;
    }>;
    assert.ok(wishes.some((wish) => wish.id === (namedWish.data as {id: string}).id));
    const hiddenAuthor = wishes.find((wish) =>
      wish.id === (anonymousWish.data as {id: string}).id);
    assert.equal(hiddenAuthor?.anonymous, true);
    assert.equal(hiddenAuthor?.authorName, "匿名");
    assert.equal(hiddenAuthor?.category, "curiosity");

    await assert.rejects(() => named.deleteWish({
      wishId: (anonymousWish.data as {id: string}).id,
    }), (error: {code?: string}) => error.code === "functions/permission-denied");
    const deleted = await admin.deleteWish({wishId: (anonymousWish.data as {id: string}).id});
    assert.deepEqual(deleted.data, {
      id: (anonymousWish.data as {id: string}).id,
      deleted: true,
    });
  });
});

describe("公佈欄", () => {
  test("管理員可以發佈、編輯與刪除公告，一般使用者只能瀏覽", async () => {
    const user = await createClient("announcement-user");
    const admin = await createClient("announcement-admin", true);
    await assert.rejects(() => user.saveAnnouncement({
      title: "不應建立",
      content: "一般使用者不能建立公告",
      category: "general",
      published: true,
    }), (error: {code?: string}) => error.code === "functions/permission-denied");

    const created = await admin.saveAnnouncement({
      title: "測試公告",
      contentHtml: '<p><strong>公開公告</strong><script>alert("x")</script></p>',
      category: "event",
      published: true,
    });
    const id = (created.data as {id: string}).id;
    const published = (await user.listPublishedAnnouncements()).data as Array<{id: string; contentHtml: string}>;
    assert.ok(published.some((announcement) => announcement.id === id));
    assert.equal(published.find((announcement) => announcement.id === id)?.contentHtml,
      "<p><strong>公開公告</strong></p>");

    await admin.saveAnnouncement({
      id,
      title: "更新後公告",
      content: "公告內容已更新",
      category: "update",
      published: false,
    });
    const all = (await admin.listAnnouncements()).data as Array<{
      id: string;
      published: boolean;
    }>;
    assert.equal(all.find((announcement) => announcement.id === id)?.published, false);
    const deleted = await admin.deleteAnnouncement({id});
    assert.deepEqual(deleted.data, {id, deleted: true});
  });
});

describe("管理員 QR code 管理", () => {
  test("一般使用者無法建立活動", async () => {
    const client = await createClient("david");
    await assert.rejects(() => client.createQrCampaign({
      title: "不應建立的活動",
      description: "測試活動內文",
      points: 5,
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 60_000,
    }), (error: {code?: string}) => error.code === "functions/permission-denied");
  });

  test("管理員可以建立、查詢並停用活動", async () => {
    const client = await createClient("erin", true);
    const created = await client.createQrCampaign({
      title: "管理員整合測試",
      description: "活動詳細說明",
      points: 8,
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 60_000,
    });
    const campaign = created.data as {id: string; url: string; svg: string; active: boolean; description: string};
    assert.match(campaign.id, /^[a-f0-9]{36}$/);
    assert.match(campaign.url, new RegExp(`redeem=${campaign.id}`));
    assert.match(campaign.svg, /<svg/);
    assert.equal(campaign.active, true);
    assert.equal(campaign.description, "活動詳細說明");

    const listed = await client.listQrCampaigns();
    assert.ok((listed.data as Array<{id: string}>).some((item) => item.id === campaign.id));
    const publicList = await client.listPublicQrCampaigns();
    assert.ok((publicList.data as Array<{id: string}>).some((item) => item.id === campaign.id));

    const disabled = await client.setQrCampaignStatus({campaignId: campaign.id, active: false});
    assert.deepEqual(disabled.data, {id: campaign.id, active: false});
  });
});

describe("積分管理", () => {
  test("管理員可批次加點並留下使用者帳本", async () => {
    const first = await createClient("points-first");
    const second = await createClient("points-second");
    const admin = await createClient("points-admin", true);
    await first.saveProfile({realName: "甲同學", nickname: "甲", dept: "教院", bio: "", avatar: ""});
    await second.saveProfile({realName: "乙同學", nickname: "乙", dept: "教院", bio: "", avatar: ""});

    const result = await admin.batchAddPoints({
      userIds: [first.auth.currentUser!.uid, second.auth.currentUser!.uid],
      points: 7,
      reason: "協助活動場佈",
    });
    assert.deepEqual(result.data, {updated: 2, points: 7, reason: "協助活動場佈"});
    const history = (await first.getPointHistory()).data as Array<{delta: number; label: string}>;
    assert.equal(history[0]?.delta, 7);
    assert.equal(history[0]?.label, "協助活動場佈");

    const users = (await admin.listUsers()).data as Array<{
      uid: string;
      realName: string;
      points: number;
    }>;
    const firstUser = users.find((user) => user.uid === first.auth.currentUser!.uid);
    assert.equal(firstUser?.realName, "甲同學");
    assert.equal(firstUser?.points, 7);
  });

  test("一般使用者不能批次加點", async () => {
    const user = await createClient("points-regular");
    await assert.rejects(() => user.batchAddPoints({
      userIds: [user.auth.currentUser!.uid],
      points: 10,
      reason: "不應成功",
    }), (error: {code?: string}) => error.code === "functions/permission-denied");
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
      description: "初始化測試",
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
      description: "撤權測試",
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
