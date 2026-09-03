import {randomBytes} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {getAuth, UserRecord} from "firebase-admin/auth";
import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import QRCode from "qrcode";
import sanitizeHtml from "sanitize-html";
import {
  optionalText,
  positiveInteger,
  requiredPreservedText,
  requiredText,
  timestampMillis,
} from "./validation";

initializeApp();

setGlobalOptions({
  region: "asia-east1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cpu: "gcf_gen1",
  concurrency: 1,
  maxInstances: 20,
});

const db = getFirestore();
const adminAuth = getAuth();
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
const publicAppUrl = process.env.PUBLIC_APP_URL || "https://coespark-a3f6e.web.app";
const initialSuperAdminEmail = (process.env.INITIAL_SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
const callableOptions = {enforceAppCheck};
const wishCategories = ["suggestion", "feedback", "curiosity", "other"] as const;

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
  if (request.auth.token.admin !== true && request.auth.token.superAdmin !== true) {
    throw new HttpsError("permission-denied", "你沒有管理員權限");
  }
}

function adminFlags(token: Record<string, unknown>) {
  const isSuperAdmin = token.superAdmin === true;
  return {
    isAdmin: token.admin === true || isSuperAdmin,
    isSuperAdmin,
  };
}

function canBootstrapSuperAdmin(token: Record<string, unknown>) {
  const email = typeof token.email === "string" ? token.email.toLowerCase() : "";
  return Boolean(initialSuperAdminEmail) &&
    token.email_verified === true &&
    email === initialSuperAdminEmail &&
    token.superAdmin !== true;
}

function requiredEmail(value: unknown): string {
  const email = requiredText(value, "電子郵件", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "電子郵件格式不正確");
  }
  return email;
}

async function getUserByEmail(email: string): Promise<UserRecord> {
  try {
    return await adminAuth.getUserByEmail(email);
  } catch (error) {
    if ((error as {code?: string})?.code === "auth/user-not-found") {
      throw new HttpsError("not-found", "找不到這個使用者，請確認對方已登入過網站");
    }
    throw error;
  }
}

function adminUserSummary(user: UserRecord) {
  const claims = user.customClaims ?? {};
  const isSuperAdmin = claims.superAdmin === true;
  return {
    uid: user.uid,
    email: user.email ?? "",
    displayName: user.displayName ?? "",
    disabled: user.disabled,
    isAdmin: claims.admin === true || isSuperAdmin,
    isSuperAdmin,
  };
}

function sanitizeAnnouncementHtml(value: unknown): string {
  const html = requiredText(value, "公告內容", 10000);
  const sanitized = sanitizeHtml(html, {
    allowedTags: ["p", "div", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "img"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "loading"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {img: ["https"]},
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {...attribs, target: "_blank", rel: "noopener noreferrer"},
      }),
      img: (_tagName, attribs) => ({
        tagName: "img",
        attribs: {
          src: attribs.src ?? "",
          alt: attribs.alt ?? "",
          loading: "lazy",
        },
      }),
    },
  }).trim();
  const textContent = sanitizeHtml(sanitized, {allowedTags: [], allowedAttributes: {}}).trim();
  if (!textContent && !/<img\b/i.test(sanitized)) {
    throw new HttpsError("invalid-argument", "公告內容不能為空白");
  }
  return sanitized;
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
  const roles = adminFlags(request.auth.token);
  const bootstrapEligible = canBootstrapSuperAdmin(request.auth.token);
  const profile = await loadAndMigrateProfile(request.auth.uid, request.auth.token.email);
  if (!profile) return {profile: null, ...roles, canBootstrapSuperAdmin: bootstrapEligible};
  const storedHistory = await rewardHistory(request.auth.uid);
  return {
    profile: {
      ...profile,
      history: [...storedHistory, ...profile.legacyHistory],
    },
    ...roles,
    canBootstrapSuperAdmin: bootstrapEligible,
  };
});

export const bootstrapSuperAdmin = onCall(callableOptions, async (request) => {
  requireAuth(request);
  if (!canBootstrapSuperAdmin(request.auth.token)) {
    throw new HttpsError("permission-denied", "這個帳號不能啟用管理員權限");
  }

  const email = String(request.auth.token.email).toLowerCase();
  const bootstrapRef = db.doc("systemConfig/adminBootstrap");
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(bootstrapRef);
    if (snapshot.exists && snapshot.data()?.uid !== request.auth.uid) {
      throw new HttpsError("failed-precondition", "第一位管理員已完成初始化");
    }
    transaction.set(bootstrapRef, {
      uid: request.auth.uid,
      email,
      createdAt: snapshot.data()?.createdAt ?? FieldValue.serverTimestamp(),
      completed: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
  });

  const user = await adminAuth.getUser(request.auth.uid);
  await adminAuth.setCustomUserClaims(user.uid, {
    ...(user.customClaims ?? {}),
    admin: true,
    superAdmin: true,
  });
  await bootstrapRef.set({
    completed: true,
    completedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  await db.collection("adminAuditLogs").add({
    action: "bootstrap_super_admin",
    actorUid: request.auth.uid,
    actorEmail: email,
    targetUid: request.auth.uid,
    targetEmail: email,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {isAdmin: true, isSuperAdmin: true};
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

export const createWish = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const message = requiredText(request.data?.message, "留言", 500);
  if (typeof request.data?.anonymous !== "boolean") {
    throw new HttpsError("invalid-argument", "匿名設定格式不正確");
  }
  const category = requiredText(request.data?.category, "留言標籤", 20);
  if (!wishCategories.includes(category as typeof wishCategories[number])) {
    throw new HttpsError("invalid-argument", "留言標籤不存在");
  }

  const profile = await db.doc(`users/${request.auth.uid}`).get();
  const profileData = profile.data() ?? {};
  const tokenName = typeof request.auth.token.name === "string" ? request.auth.token.name : "";
  const authorName = typeof profileData.nickname === "string" && profileData.nickname.trim() ?
    profileData.nickname.trim() : tokenName || "小火花夥伴";
  const wishRef = db.collection("wishes").doc();
  const rateLimitRef = db.doc(`wishRateLimits/${request.auth.uid}`);
  const now = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const rateLimit = await transaction.get(rateLimitRef);
    const lastCreatedAt = rateLimit.data()?.lastCreatedAt;
    if (lastCreatedAt instanceof Timestamp && now.toMillis() - lastCreatedAt.toMillis() < 5000) {
      throw new HttpsError("resource-exhausted", "留言送出太快，請稍候再試");
    }
    transaction.create(wishRef, {
      message,
      anonymous: request.data.anonymous,
      category,
      authorUid: request.auth.uid,
      authorName,
      createdAt: now,
    });
    transaction.set(rateLimitRef, {lastCreatedAt: now});
  });

  return {
    id: wishRef.id,
    message,
    anonymous: request.data.anonymous,
    category,
    authorName: request.data.anonymous ? "匿名" : authorName,
    createdAt: now.toMillis(),
  };
});

export const listWishes = onCall(callableOptions, async (request) => {
  const snapshot = await db.collection("wishes").orderBy("createdAt", "desc").limit(100).get();
  const likedWishIds = new Set<string>();
  if (request.auth && snapshot.docs.length) {
    const likeSnapshots = await db.getAll(...snapshot.docs.map((item) =>
      item.ref.collection("likes").doc(request.auth!.uid)));
    likeSnapshots.forEach((item, index) => {
      if (item.exists) likedWishIds.add(snapshot.docs[index].id);
    });
  }
  return snapshot.docs.map((item) => {
    const data = item.data();
    const anonymous = data.anonymous === true;
    return {
      id: item.id,
      message: typeof data.message === "string" ? data.message : "",
      anonymous,
      category: wishCategories.includes(data.category) ? data.category : "suggestion",
      authorName: anonymous ? "匿名" : typeof data.authorName === "string" ?
        data.authorName : "小火花夥伴",
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null,
      adminReply: typeof data.adminReply === "string" ? data.adminReply : "",
      repliedAt: data.repliedAt instanceof Timestamp ? data.repliedAt.toMillis() : null,
      likesCount: Number.isInteger(data.likesCount) && data.likesCount > 0 ? data.likesCount : 0,
      likedByMe: likedWishIds.has(item.id),
    };
  });
});

export const toggleWishLike = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const wishId = requiredText(request.data?.wishId, "留言代碼", 128);
  const wishRef = db.doc(`wishes/${wishId}`);
  const likeRef = wishRef.collection("likes").doc(request.auth.uid);

  return db.runTransaction(async (transaction) => {
    const [wishSnapshot, likeSnapshot] = await Promise.all([
      transaction.get(wishRef),
      transaction.get(likeRef),
    ]);
    if (!wishSnapshot.exists) throw new HttpsError("not-found", "找不到這則留言");
    const currentCount = Math.max(0, Number(wishSnapshot.data()?.likesCount) || 0);
    const liked = !likeSnapshot.exists;
    const likesCount = liked ? currentCount + 1 : Math.max(0, currentCount - 1);
    transaction.update(wishRef, {likesCount});
    if (liked) {
      transaction.create(likeRef, {
        userUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      transaction.delete(likeRef);
    }
    return {id: wishId, liked, likesCount};
  });
});

export const replyWish = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const wishId = requiredText(request.data?.wishId, "留言代碼", 128);
  const reply = requiredText(request.data?.reply, "回覆內容", 1000);
  const wishRef = db.doc(`wishes/${wishId}`);
  const auditRef = db.collection("adminAuditLogs").doc();
  const repliedAt = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(wishRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "找不到這則留言");
    transaction.update(wishRef, {
      adminReply: reply,
      repliedAt,
      repliedBy: request.auth.uid,
    });
    transaction.create(auditRef, {
      action: "reply_wish",
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email ?? "",
      targetId: wishId,
      targetAuthorUid: snapshot.data()?.authorUid ?? "",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {id: wishId, adminReply: reply, repliedAt: repliedAt.toMillis()};
});

export const deleteWish = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const wishId = requiredText(request.data?.wishId, "留言代碼", 128);
  const wishRef = db.doc(`wishes/${wishId}`);
  const auditRef = db.collection("adminAuditLogs").doc();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(wishRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "找不到這則留言");
    transaction.delete(wishRef);
    transaction.create(auditRef, {
      action: "delete_wish",
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email ?? "",
      targetId: wishId,
      targetAuthorUid: snapshot.data()?.authorUid ?? "",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  console.info("Wish deleted", {wishId, actorUid: request.auth.uid});
  return {id: wishId, deleted: true};
});

const announcementCategories = ["general", "event", "update", "reward"] as const;

function announcementData(item: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = item.data() ?? {};
  return {
    id: item.id,
    title: typeof data.title === "string" ? data.title : "",
    content: typeof data.content === "string" ? data.content : "",
    contentHtml: typeof data.contentHtml === "string" ? data.contentHtml : "",
    category: announcementCategories.includes(data.category) ? data.category : "general",
    published: data.published === true,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null,
  };
}

export const listPublishedAnnouncements = onCall(callableOptions, async () => {
  const snapshot = await db.collection("announcements").where("published", "==", true).limit(100).get();
  return snapshot.docs.map(announcementData)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
});

export const listAnnouncements = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const snapshot = await db.collection("announcements").orderBy("updatedAt", "desc").limit(100).get();
  return snapshot.docs.map(announcementData);
});

export const saveAnnouncement = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const announcementId = optionalText(request.data?.id, "公告代碼", 128);
  const title = requiredText(request.data?.title, "公告標題", 80);
  const contentHtml = sanitizeAnnouncementHtml(request.data?.contentHtml ?? request.data?.content);
  const content = sanitizeHtml(contentHtml, {allowedTags: [], allowedAttributes: {}}).trim();
  const category = requiredText(request.data?.category, "公告分類", 20);
  if (!announcementCategories.includes(category as typeof announcementCategories[number])) {
    throw new HttpsError("invalid-argument", "公告分類不存在");
  }
  if (typeof request.data?.published !== "boolean") {
    throw new HttpsError("invalid-argument", "發佈狀態格式不正確");
  }

  const ref = announcementId ? db.doc(`announcements/${announcementId}`) :
    db.collection("announcements").doc();
  const existing = announcementId ? await ref.get() : null;
  if (announcementId && !existing?.exists) throw new HttpsError("not-found", "找不到這則公告");
  await ref.set({
    title,
    content,
    contentHtml,
    category,
    published: request.data.published,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
    ...(!existing?.exists ? {
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
    } : {}),
  }, {merge: true});
  await db.collection("adminAuditLogs").add({
    action: announcementId ? "update_announcement" : "create_announcement",
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email ?? "",
    targetId: ref.id,
    createdAt: FieldValue.serverTimestamp(),
  });
  return {id: ref.id, title, content, contentHtml, category, published: request.data.published};
});

export const deleteAnnouncement = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const announcementId = requiredText(request.data?.id, "公告代碼", 128);
  const ref = db.doc(`announcements/${announcementId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "找不到這則公告");
  const auditRef = db.collection("adminAuditLogs").doc();
  const batch = db.batch();
  batch.delete(ref);
  batch.create(auditRef, {
    action: "delete_announcement",
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email ?? "",
    targetId: announcementId,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return {id: announcementId, deleted: true};
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
    transaction.update(campaignRef, {
      redemptionCount: FieldValue.increment(1),
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
  const options = {
    errorCorrectionLevel: "M" as const,
    margin: 2,
    width: 720,
  };
  const [svg, pngDataUrl] = await Promise.all([
    QRCode.toString(url, {
      type: "svg",
      ...options,
    }),
    QRCode.toDataURL(url, {
      type: "image/png",
      ...options,
    }),
  ]);
  return {url, svg, pngDataUrl};
}

export const createQrCampaign = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const title = requiredText(request.data?.title, "活動名稱", 80);
  const description = requiredPreservedText(request.data?.description, "活動內文", 2000);
  const points = positiveInteger(request.data?.points, "活動點數", 100);
  const startsAtMillis = timestampMillis(request.data?.startsAt, "開始時間");
  const endsAtMillis = timestampMillis(request.data?.endsAt, "結束時間");
  if (endsAtMillis <= startsAtMillis) {
    throw new HttpsError("invalid-argument", "結束時間必須晚於開始時間");
  }

  const campaignId = randomBytes(18).toString("hex");
  await db.doc(`qrCampaigns/${campaignId}`).create({
    title,
    description,
    points,
    startsAt: Timestamp.fromMillis(startsAtMillis),
    endsAt: Timestamp.fromMillis(endsAtMillis),
    active: true,
    redemptionCount: 0,
    createdBy: request.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {id: campaignId, title, description, points, startsAt: startsAtMillis, endsAt: endsAtMillis, active: true, ...await campaignQr(campaignId)};
});

export const updateQrCampaign = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const campaignId = requiredText(request.data?.campaignId, "活動代碼", 64);
  const title = requiredText(request.data?.title, "活動名稱", 80);
  const description = requiredPreservedText(request.data?.description, "活動內文", 2000);
  const points = positiveInteger(request.data?.points, "活動點數", 100);
  const startsAtMillis = timestampMillis(request.data?.startsAt, "開始時間");
  const endsAtMillis = timestampMillis(request.data?.endsAt, "結束時間");
  if (endsAtMillis <= startsAtMillis) {
    throw new HttpsError("invalid-argument", "結束時間必須晚於開始時間");
  }

  const campaignRef = db.doc(`qrCampaigns/${campaignId}`);
  const legacyRedemption = await db.collection("qrRedemptions")
    .where("campaignId", "==", campaignId)
    .limit(1)
    .get();
  const auditRef = db.collection("adminAuditLogs").doc();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(campaignRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "找不到這個活動");
    const campaign = snapshot.data()!;
    const hasRedemptions = numberOrZero(campaign.redemptionCount) > 0 || !legacyRedemption.empty;
    if (numberOrZero(campaign.points) !== points && hasRedemptions) {
      throw new HttpsError("failed-precondition", "已有使用者兌換此活動，無法修改活動點數");
    }
    transaction.update(campaignRef, {
      title,
      description,
      points,
      startsAt: Timestamp.fromMillis(startsAtMillis),
      endsAt: Timestamp.fromMillis(endsAtMillis),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    });
    transaction.create(auditRef, {
      action: "update_qr_campaign",
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email ?? "",
      campaignId,
      title,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {id: campaignId, title, description, points, startsAt: startsAtMillis, endsAt: endsAtMillis};
});

export const listQrCampaigns = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const snapshot = await db.collection("qrCampaigns").orderBy("createdAt", "desc").limit(100).get();
  return Promise.all(snapshot.docs.map(async (item) => {
    const data = item.data();
    return {
      id: item.id,
      title: data.title,
      description: typeof data.description === "string" ? data.description : "",
      points: data.points,
      active: data.active === true,
      redemptionCount: numberOrZero(data.redemptionCount),
      startsAt: data.startsAt instanceof Timestamp ? data.startsAt.toMillis() : null,
      endsAt: data.endsAt instanceof Timestamp ? data.endsAt.toMillis() : null,
      url: campaignUrl(item.id),
    };
  }));
});

export const listPublicQrCampaigns = onCall(callableOptions, async (request) => {
  const [snapshot, redemptionSnapshot] = await Promise.all([
    db.collection("qrCampaigns").orderBy("startsAt", "desc").limit(100).get(),
    request.auth ? db.collection("qrRedemptions")
      .where("uid", "==", request.auth.uid)
      .limit(500)
      .get() : null,
  ]);
  const redeemedCampaignIds = new Set((redemptionSnapshot?.docs ?? [])
    .map((item) => item.data().campaignId)
    .filter((campaignId): campaignId is string => typeof campaignId === "string"));
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      title: typeof data.title === "string" ? data.title : "",
      description: typeof data.description === "string" ? data.description : "",
      points: numberOrZero(data.points),
      active: data.active === true,
      startsAt: data.startsAt instanceof Timestamp ? data.startsAt.toMillis() : null,
      endsAt: data.endsAt instanceof Timestamp ? data.endsAt.toMillis() : null,
      redeemed: redeemedCampaignIds.has(item.id),
    };
  }).filter((campaign) => campaign.active);
});

export const getQrCampaign = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const campaignId = requiredText(request.data?.campaignId, "活動代碼", 64);
  const snapshot = await db.doc(`qrCampaigns/${campaignId}`).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "找不到這個活動");
  const data = snapshot.data()!;
  const redemptionSnapshot = await db.collection("qrRedemptions")
    .where("campaignId", "==", campaignId)
    .limit(1)
    .get();
  return {
    id: snapshot.id,
    title: data.title,
    description: typeof data.description === "string" ? data.description : "",
    points: data.points,
    active: data.active === true,
    hasRedemptions: numberOrZero(data.redemptionCount) > 0 || !redemptionSnapshot.empty,
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

export const lookupAdminUser = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const email = requiredEmail(request.data?.email);
  return adminUserSummary(await getUserByEmail(email));
});

export const listAdminUsers = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const users: ReturnType<typeof adminUserSummary>[] = [];
  let pageToken: string | undefined;
  let pagesRead = 0;
  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    users.push(...page.users
      .filter((user) => user.customClaims?.admin === true || user.customClaims?.superAdmin === true)
      .map(adminUserSummary));
    pageToken = page.pageToken;
    pagesRead += 1;
  } while (pageToken && pagesRead < 10);

  return users.sort((a, b) => Number(b.isSuperAdmin) - Number(a.isSuperAdmin) ||
    a.email.localeCompare(b.email));
});

export const listUsers = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const searchText = optionalText(request.data?.query, "查詢文字", 254).toLocaleLowerCase("zh-TW");
  const users: Array<ReturnType<typeof adminUserSummary> & PublicProfile & {
    realName: string;
    createdAt: number | null;
    lastSignInAt: number | null;
  }> = [];
  let pageToken: string | undefined;
  let pagesRead = 0;

  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    if (page.users.length) {
      const publicProfiles = await db.getAll(...page.users.map((user) => db.doc(`users/${user.uid}`)));
      const privateProfiles = await db.getAll(...page.users.map((user) =>
        db.doc(`usersPrivate/${user.uid}`)));
      page.users.forEach((user, index) => {
        const summary = adminUserSummary(user);
        const publicData = publicProfiles[index].data() ?? {};
        const privateData = privateProfiles[index].data() ?? {};
        const profile = sanitizePublicProfile(publicData);
        const realName = typeof privateData.realName === "string" ? privateData.realName :
          typeof publicData.realName === "string" ? publicData.realName : "";
        const createdAt = privateData.createdAt instanceof Timestamp ? privateData.createdAt.toMillis() :
          user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : null;
        const searchable = [summary.email, summary.displayName, profile.nickname, realName]
          .join("\n").toLocaleLowerCase("zh-TW");
        if (!searchText || searchable.includes(searchText)) {
          users.push({
            ...summary,
            ...profile,
            realName,
            createdAt,
            lastSignInAt: user.metadata.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : null,
          });
        }
      });
    }
    pageToken = page.pageToken;
    pagesRead += 1;
  } while (pageToken && pagesRead < 10);

  return users
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.email.localeCompare(b.email))
    .slice(0, 10);
});

export const batchAddPoints = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  if (!Array.isArray(request.data?.userIds) || request.data.userIds.length < 1 ||
      request.data.userIds.length > 100) {
    throw new HttpsError("invalid-argument", "每次請選擇 1 至 100 位使用者");
  }
  const userIds = [...new Set(request.data.userIds.map((value: unknown) =>
    requiredText(value, "使用者代碼", 128)))];
  const points = Number(request.data?.points);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000) {
    throw new HttpsError("invalid-argument", "調整點數必須是 -1000 至 1000 之間的非零整數");
  }
  const reason = requiredText(request.data?.reason, "調整理由", 200);
  const auditRef = db.collection("adminAuditLogs").doc();

  await db.runTransaction(async (transaction) => {
    const refs = userIds.map((uid) => db.doc(`users/${uid}`));
    const snapshots = await transaction.getAll(...refs);
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      throw new HttpsError("not-found", "部分使用者尚未建立個人檔案");
    }
    if (points < 0 && snapshots.some((snapshot) => numberOrZero(snapshot.data()?.points) + points < 0)) {
      throw new HttpsError("failed-precondition", "部分使用者的積分不足，無法完成扣除");
    }
    snapshots.forEach((snapshot) => {
      const uid = snapshot.id;
      const ledgerRef = db.collection(`usersPrivate/${uid}/pointLedger`).doc();
      transaction.update(snapshot.ref, {
        points: FieldValue.increment(points),
        ...(points > 0 ? {totalPoints: FieldValue.increment(points)} : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(ledgerRef, {
        delta: points,
        type: "admin",
        sourceId: auditRef.id,
        label: reason,
        actorUid: request.auth.uid,
        actorEmail: request.auth.token.email ?? "",
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.create(auditRef, {
      action: "batch_adjust_points",
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email ?? "",
      targetUids: userIds,
      points,
      reason,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return {updated: userIds.length, points, reason};
});

export const getPointHistory = onCall(callableOptions, async (request) => {
  requireAuth(request);
  const snapshot = await db.collection(`usersPrivate/${request.auth.uid}/pointLedger`)
    .orderBy("createdAt", "desc").limit(100).get();
  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      delta: numberOrZero(data.delta),
      type: typeof data.type === "string" ? data.type : "other",
      label: typeof data.label === "string" ? data.label : "積分異動",
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null,
    };
  });
});

export const setAdminRole = onCall(callableOptions, async (request) => {
  requireAdmin(request);
  const email = requiredEmail(request.data?.email);
  if (typeof request.data?.admin !== "boolean") {
    throw new HttpsError("invalid-argument", "管理員狀態格式不正確");
  }

  const target = await getUserByEmail(email);
  const targetClaims = {...(target.customClaims ?? {})};
  if (targetClaims.superAdmin === true && request.data.admin !== true) {
    throw new HttpsError("failed-precondition", "受保護的初始管理員不能在此頁撤銷");
  }
  if (target.uid === request.auth.uid && request.data.admin !== true) {
    throw new HttpsError("failed-precondition", "不能撤銷自己的管理員權限");
  }

  if (request.data.admin) {
    targetClaims.admin = true;
  } else {
    delete targetClaims.admin;
  }
  await adminAuth.setCustomUserClaims(target.uid, targetClaims);

  await db.collection("adminAuditLogs").add({
    action: request.data.admin ? "grant_admin" : "revoke_admin",
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email ?? "",
    targetUid: target.uid,
    targetEmail: target.email ?? email,
    createdAt: FieldValue.serverTimestamp(),
  });

  const updated = await adminAuth.getUser(target.uid);
  return adminUserSummary(updated);
});
