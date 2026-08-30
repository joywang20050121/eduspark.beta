import {readFileSync} from "node:fs";
import {after, before, beforeEach, describe, test} from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {doc, getDoc, setDoc, updateDoc} from "firebase/firestore";

let testEnvironment: RulesTestEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: "demo-eduspark",
    firestore: {
      rules: readFileSync("../firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "users/alice"), {
      nickname: "Alice",
      points: 10,
      totalPoints: 10,
    });
    await setDoc(doc(database, "usersPrivate/alice"), {
      realName: "王小花",
      email: "alice@example.com",
    });
    await setDoc(doc(database, "usersPrivate/bob"), {
      realName: "陳小明",
      email: "bob@example.com",
    });
    await setDoc(doc(database, "qrRedemptions/campaign_alice"), {
      uid: "alice",
      points: 2,
    });
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

describe("公開個人資料", () => {
  test("未登入者不能讀取", async () => {
    const database = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(database, "users/alice")));
  });

  test("登入者可以讀取排行榜資料", async () => {
    const database = testEnvironment.authenticatedContext("bob").firestore();
    await assertSucceeds(getDoc(doc(database, "users/alice")));
  });

  test("使用者不能直接修改自己的積分", async () => {
    const database = testEnvironment.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(database, "users/alice"), {points: 9999}));
  });
});

describe("私人資料", () => {
  test("使用者可以讀取自己的私人資料", async () => {
    const database = testEnvironment.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(database, "usersPrivate/alice")));
  });

  test("使用者不能讀取其他人的私人資料", async () => {
    const database = testEnvironment.authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(database, "usersPrivate/bob")));
  });

  test("管理員可以讀取私人資料，但仍不能由前端改寫", async () => {
    const database = testEnvironment.authenticatedContext("admin", {admin: true}).firestore();
    await assertSucceeds(getDoc(doc(database, "usersPrivate/alice")));
    await assertFails(updateDoc(doc(database, "usersPrivate/alice"), {realName: "竄改資料"}));
  });
});

describe("QR code 兌換紀錄", () => {
  test("使用者只能讀取自己的紀錄", async () => {
    const aliceDatabase = testEnvironment.authenticatedContext("alice").firestore();
    const bobDatabase = testEnvironment.authenticatedContext("bob").firestore();
    await assertSucceeds(getDoc(doc(aliceDatabase, "qrRedemptions/campaign_alice")));
    await assertFails(getDoc(doc(bobDatabase, "qrRedemptions/campaign_alice")));
  });

  test("使用者不能自行建立兌換紀錄", async () => {
    const database = testEnvironment.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(database, "qrRedemptions/fake_alice"), {
      uid: "alice",
      points: 100,
    }));
  });
});
