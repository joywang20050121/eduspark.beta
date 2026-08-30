import {randomBytes} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import QRCode from "qrcode";
import {optionalText, positiveInteger, requiredText, timestampMillis} from "./validation";

initializeApp();

setGlobalOptions({
  region: "asia-east1",
  memory: "256MiB",
  timeoutSeconds: 30,
  maxInstances: 100,
});

const db = getFirestore();
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
const publicAppUrl = process.env.PUBLIC_APP_URL || "https://coespark-a3f6e.web.app";
const callableOptions = {enforceAppCheck};

type AuthenticatedRequest<T = unknown> = CallableRequest<T> & {
  auth: NonNullable<CallableRequest<T>["auth"]>;
};

type PublicProfile = {
  nickname: string;
  dept: string;
  bio: string;
  avatar: string;
  points: number;
  totalPoints: number;
};

const rewards = {
  starbucks: {name: "星巴克一杯", cost: 10},
  sevenEleven100: {name: "7-11 100 元禮品券", cost: 20},
  microCredit02: {name: "0.2 微學分", cost: 30},
} as const;

function requireAuth<T>(request: CallableRequest<T>): asserts request is AuthenticatedRequest<T> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "請先登入帳號");
  }
}

function requireAdmin<T>(request: CallableRequest<T>): asserts request is AuthenticatedRequest<T> {
  requireAuth(request);
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "你沒有管理員權限");
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function legacyRedeemedPoints(history: unknown): number {
  if (!Array.isArray(history)) return 0;
  return history.reduce((total, item) => {
    if (!item || typeof item !== "object") return total;
    const cost = numberOrZero((item as {cost?: unknown}).cost);
    return total + Math.max(0, cost);
  }, 0);
}

function sanitizePublicProfile(data: Record<string, unknown>): PublicProfile {
  const points = Math.max(0, numberOrZero(data.points));
  const totalPoints = Math.max(
    points,
    numberOrZero(data.totalPoints) || points + legacyRedeemedPoints(data.history),
  );
  return {
    nickname: typeof data.nickname === "string" ? data.nickname : "小火花夥伴",
    dept: typeof data.dept === "string" ? data.dept : "",
    bio: typeof data.bio === "string" ? data.bio : "",
    avatar: typeof data.avatar === "string" ? data.avatar : "",
    points,
    totalPoints,
  };
}

async function loadAndMigrateProfile(uid: string, email: string | undefined) {
  const publicRef = db.doc(`users/${uid}`);
  const privateRef = db.doc(`usersPrivate/${uid}`);

  return db.runTransaction(async (transaction) => {
    const [publicSnapshot, privateSnapshot] = await Promise.all([
      transaction.get(publicRef),
      transaction.get(privateRef),
    ]);
    if (!publicSnapshot.exists) return null;

    const legacyData = publicSnapshot.data() as Record<string, unknown>;
    const publicProfile = sanitizePublicProfile(legacyData);
    const privateData = privateSnapshot.data() ?? {};
    const realName = typeof privateData.realName === "string" ? privateData.realName :
      typeof legacyData.realName === "string" ? legacyData.realName : "";
    const legacyHistory = Array.isArray(legacyData.history) ? legacyData.history :
      Array.isArray(privateData.legacyRewardHistory) ? privateData.legacyRewardHistory : [];

    transaction.set(publicRef, {
      ...publicProfile,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(privateRef, {
      realName,
      email: email ?? privateData.email ?? "",
      legacyRewardHistory: legacyHistory,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!privateSnapshot.exists ? {createdAt: FieldValue.serverTimestamp()} : {}),
    }, {merge: true});

    return {
      ...publicProfile,
      realName,
      legacyHistory,
    };
  });
}

async function rewardHistory(uid: string) {
  const snapshot = await db.collection(`usersPrivate/${uid}/rewardRedemptions`)
    .orderBy("redeemedAt", "desc")
    .limit(100)
    .get();
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      name: data.name,
      cost: data.cost,
      time: data.redeemedAt instanceof Timestamp ? data.redeemedAt.toMillis() : null,
    };
  });
}

export const getMyProfile = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const profile = await loadAndMigrateProfile(request.auth.uid, request.auth.token.email);
  if (!profile) return {profile: null, isAdmin: request.auth.token.admin === true};
  const storedHistory = await rewardHistory(request.auth.uid);
  return {
    profile: {
      ...profile,
      history: [...storedHistory, ...profile.legacyHistory],
    },
    isAdmin: request.auth.token.admin === true,
  };
});

export const saveProfile = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const realName = requiredText(request.data?.realName, "真實姓名", 50);
  const nickname = requiredText(request.data?.nickname, "公開暱稱", 30);
  const dept = optionalText(request.data?.dept, "系級", 50);
  const bio = optionalText(request.data?.bio, "自我介紹", 50);
  const avatar = optionalText(request.data?.avatar, "頭像", 8000);
  const publicRef = db.doc(`users/${request.auth.uid}`);
  const privateRef = db.doc(`usersPrivate/${request.auth.uid}`);

  const profile = await db.runTransaction(async (transaction) => {
    const [publicSnapshot, privateSnapshot] = await Promise.all([
      transaction.get(publicRef),
      transaction.get(privateRef),
    ]);
    const current = publicSnapshot.exists ? sanitizePublicProfile(publicSnapshot.data()!) : null;
    const result: PublicProfile = {
      nickname,
      dept,
      bio,
      avatar,
      points: current?.points ?? 0,
      totalPoints: current?.totalPoints ?? 0,
    };
    transaction.set(publicRef, {...result, updatedAt: FieldValue.serverTimestamp()});
    transaction.set(privateRef, {
      realName,
      email: request.auth.token.email ?? "",
      updatedAt: FieldValue.serverTimestamp(),
      ...(!privateSnapshot.exists ? {createdAt: FieldValue.serverTimestamp()} : {}),
    }, {merge: true});
    return result;
  });

  return {...profile, realName};
});

export const redeemReward = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const rewardId = request.data?.rewardId;
  if (typeof rewardId !== "string" || !(rewardId in rewards)) {
    throw new HttpsError("invalid-argument", "獎勵項目不存在");
  }
  const reward = rewards[rewardId as keyof typeof rewards];
  const publicRef = db.doc(`users/${request.auth.uid}`);
  const redemptionRef = db.collection(`usersPrivate/${request.auth.uid}/rewardRedemptions`).doc();
  const ledgerRef = db.collection(`usersPrivate/${request.auth.uid}/pointLedger`).doc();

  const points = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(publicRef);
    if (!snapshot.exists) throw new HttpsError("failed-precondition", "請先建立個人檔案");
    const currentPoints = numberOrZero(snapshot.data()?.points);
    if (currentPoints < reward.cost) {
      throw new HttpsError("failed-precondition", "積分不足", {
        shortage: reward.cost - currentPoints,
      });
    }
    const newPoints = currentPoints - reward.cost;
    transaction.update(publicRef, {points: newPoints, updatedAt: FieldValue.serverTimestamp()});
    transaction.create(redemptionRef, {
      rewardId,
      name: reward.name,
      cost: reward.cost,
      redeemedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(ledgerRef, {
      delta: -reward.cost,
      type: "reward",
      sourceId: redemptionRef.id,
      label: reward.name,
      createdAt: FieldValue.serverTimestamp(),
    });
    return newPoints;
  });

  return {points, reward: {...reward, id: rewardId}, redemptionId: redemptionRef.id};
});

export const redeemQr = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const campaignId = requiredText(request.data?.campaignId, "QR code", 64);
  if (!/^[a-f0-9]{36}$/.test(campaignId)) {
    throw new HttpsError("invalid-argument", "QR code 格式不正確");
  }

  const campaignRef = db.doc(`qrCampaigns/${campaignId}`);
  const userRef = db.doc(`users/${request.auth.uid}`);
  const redemptionRef = db.doc(`qrRedemptions/${campaignId}_${request.auth.uid}`);
  const ledgerRef = db.doc(`usersPrivate/${request.auth.uid}/pointLedger/qr_${campaignId}`);

  const result = await db.runTransaction(async (transaction) => {
    const [campaignSnapshot, userSnapshot, redemptionSnapshot] = await Promise.all([
      transaction.get(campaignRef),
      transaction.get(userRef),
      transaction.get(redemptionRef),
    ]);
    if (!campaignSnapshot.exists) throw new HttpsError("not-found", "找不到這個 QR code");
    if (!userSnapshot.exists) throw new HttpsError("failed-precondition", "請先建立個人檔案");
    if (redemptionSnapshot.exists) {
      throw new HttpsError("already-exists", "你已領取過這個活動的點數");
    }

    const campaign = campaignSnapshot.data()!;
    const now = Timestamp.now();
    if (campaign.active !== true) throw new HttpsError("failed-precondition", "這個 QR code 已停用");
    if (!(campaign.startsAt instanceof Timestamp) || !(campaign.endsAt instanceof Timestamp)) {
      throw new HttpsError("internal", "活動時間設定不完整");
    }
    if (now.toMillis() < campaign.startsAt.toMillis()) {
      throw new HttpsError("failed-precondition", "活動尚未開始");
    }
    if (now.toMillis() > campaign.endsAt.toMillis()) {
      throw new HttpsError("deadline-exceeded", "這個 QR code 已過期");
    }

    const pointsToAdd = positiveInteger(campaign.points, "活動點數", 100);
    const currentPoints = numberOrZero(userSnapshot.data()?.points);
    const currentTotal = Math.max(currentPoints, numberOrZero(userSnapshot.data()?.totalPoints));
    const newPoints = currentPoints + pointsToAdd;
    const newTotal = currentTotal + pointsToAdd;
    transaction.update(userRef, {
      points: newPoints,
      totalPoints: newTotal,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(redemptionRef, {
      campaignId,
      uid: request.auth.uid,
      title: campaign.title,
      points: pointsToAdd,
      redeemedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(ledgerRef, {
      delta: pointsToAdd,
      type: "qr",
      sourceId: campaignId,
      label: campaign.title,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {points: newPoints, totalPoints: newTotal, earned: pointsToAdd, title: campaign.title};
  });

  return result;
});

function campaignUrl(campaignId: string): string {
  const url = new URL(publicAppUrl);
  url.searchParams.set("redeem", campaignId);
  return url.toString();
}

async function campaignQr(campaignId: string) {
  const url = campaignUrl(campaignId);
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 720,
  });
  return {url, svg};
}

export const createQrCampaign = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const title = requiredText(request.data?.title, "活動名稱", 80);
  const points = positiveInteger(request.data?.points, "活動點數", 100);
  const startsAtMillis = timestampMillis(request.data?.startsAt, "開始時間");
  const endsAtMillis = timestampMillis(request.data?.endsAt, "結束時間");
  if (endsAtMillis <= startsAtMillis) {
    throw new HttpsError("invalid-argument", "結束時間必須晚於開始時間");
  }

  const campaignId = randomBytes(18).toString("hex");
  await db.doc(`qrCampaigns/${campaignId}`).create({
    title,
    points,
    startsAt: Timestamp.fromMillis(startsAtMillis),
    endsAt: Timestamp.fromMillis(endsAtMillis),
    active: true,
    createdBy: request.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {id: campaignId, title, points, startsAt: startsAtMillis, endsAt: endsAtMillis, active: true, ...await campaignQr(campaignId)};
});

export const listQrCampaigns = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const snapshot = await db.collection("qrCampaigns").orderBy("createdAt", "desc").limit(100).get();
  return Promise.all(snapshot.docs.map(async (item) => {
    const data = item.data();
    return {
      id: item.id,
      title: data.title,
      points: data.points,
      active: data.active === true,
      startsAt: data.startsAt instanceof Timestamp ? data.startsAt.toMillis() : null,
      endsAt: data.endsAt instanceof Timestamp ? data.endsAt.toMillis() : null,
      url: campaignUrl(item.id),
    };
  }));
});

export const getQrCampaign = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const campaignId = requiredText(request.data?.campaignId, "活動代碼", 64);
  const snapshot = await db.doc(`qrCampaigns/${campaignId}`).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "找不到這個活動");
  const data = snapshot.data()!;
  return {
    id: snapshot.id,
    title: data.title,
    points: data.points,
    active: data.active === true,
    startsAt: data.startsAt instanceof Timestamp ? data.startsAt.toMillis() : null,
    endsAt: data.endsAt instanceof Timestamp ? data.endsAt.toMillis() : null,
    ...await campaignQr(snapshot.id),
  };
});

export const setQrCampaignStatus = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const campaignId = requiredText(request.data?.campaignId, "活動代碼", 64);
  if (typeof request.data?.active !== "boolean") {
    throw new HttpsError("invalid-argument", "活動狀態格式不正確");
  }
  await db.doc(`qrCampaigns/${campaignId}`).update({
    active: request.data.active,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  });
  return {id: campaignId, active: request.data.active};
});
