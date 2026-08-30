# 教院小火花部署與安全設定

## 架構

- Firebase Hosting：靜態網站
- Firebase Authentication：Google 登入
- Cloud Functions（TypeScript）：個人資料、QR code、積分與獎勵操作
- Cloud Firestore：公開資料、私人資料、活動與稽核紀錄
- Firebase App Check：阻擋非本站程式呼叫 Functions

## 首次設定

1. 將 Firebase 專案升級為 Blaze 方案，讓 Cloud Functions 可以部署。
2. 在 Firebase Console 建立 Firestore 資料庫，區域應與 Functions 接近。
3. 在 App Check 為 Web App 設定 reCAPTCHA Enterprise。
4. 將 reCAPTCHA Enterprise site key 填入 `public/index.html` 的 `firebase-app-check-site-key` meta 標籤。
5. 將 `functions/.env.example` 複製為 Firebase 專案使用的環境設定檔，並將 `PUBLIC_APP_URL` 設成正式網址。
6. App Check 指標確認正常後，將 `ENFORCE_APP_CHECK` 改為 `true` 再次部署。

## 安裝與檢查

```bash
cd functions
npm install
npm run check
npm run test:rules
npm run test:functions
```

Security Rules 測試需要 Java 21 或相容版本，Firebase Emulator 才能啟動。

## 部署

在專案根目錄執行：

```bash
firebase deploy --only functions,firestore
firebase deploy --only hosting
```

先部署 Functions 與 Firestore Rules，確認成功後再部署前端，避免前端呼叫尚未存在的 Functions。

## 設定第一位管理員

先取得 Google Application Default Credentials：

```bash
gcloud auth application-default login
```

再執行：

```bash
cd functions
npm run admin:set -- admin@example.com
```

管理員必須登出並重新登入，新的 Custom Claim 才會出現在登入憑證中。

## 上線檢查

- Firebase Authentication 的 Authorized domains 已加入正式網域。
- `PUBLIC_APP_URL` 是正式網址，QR code 不使用測試網址。
- App Check 已先觀察指標，再開啟強制驗證。
- Firestore Rules 測試全部通過。
- 一般帳號無法直接修改 `users/{uid}.points`。
- 同一帳號同時送出多次 QR code 兌換，只有一次成功。
- Cloud Billing 已設定預算警示。
