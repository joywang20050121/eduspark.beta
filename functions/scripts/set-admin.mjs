import {applicationDefault, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";

const email = process.argv[2]?.trim();
if (!email) {
  console.error("用法：npm run admin:set -- 管理員信箱");
  process.exitCode = 1;
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || "coespark-a3f6e",
  });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, {...user.customClaims, admin: true});
  console.log(`已將 ${email} 設為管理員。請登出後重新登入。`);
}
