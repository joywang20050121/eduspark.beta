import {initializeApp} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
    connectFunctionsEmulator,
    getFunctions,
    httpsCallable
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import {
    initializeAppCheck,
    ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";

const firebaseConfig = {
    apiKey: "AIzaSyD4tdUd6o06zxMyyOq8CwyZuixrIh5j0Kk",
    authDomain: "coespark-a3f6e.firebaseapp.com",
    projectId: "coespark-a3f6e",
    storageBucket: "coespark-a3f6e.firebasestorage.app",
    messagingSenderId: "495581170629",
    appId: "1:495581170629:web:aba68ff657942cf77b99ac",
    measurementId: "G-7WB0WT0QP1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, "asia-east1");
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: "select_account"});

if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

const appCheckSiteKey = document.querySelector('meta[name="firebase-app-check-site-key"]')?.content.trim();
if (appCheckSiteKey) {
    initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true
    });
}

const callGetMyProfile = httpsCallable(functions, "getMyProfile");
const callBootstrapSuperAdmin = httpsCallable(functions, "bootstrapSuperAdmin");
const callCreateQrCampaign = httpsCallable(functions, "createQrCampaign");
const callListQrCampaigns = httpsCallable(functions, "listQrCampaigns");
const callGetQrCampaign = httpsCallable(functions, "getQrCampaign");
const callSetQrCampaignStatus = httpsCallable(functions, "setQrCampaignStatus");
const callLookupAdminUser = httpsCallable(functions, "lookupAdminUser");
const callListUsers = httpsCallable(functions, "listUsers");
const callSetAdminRole = httpsCallable(functions, "setAdminRole");

const loading = document.getElementById("admin-loading");
const login = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
let currentQrDownload = null;
let selectedAdminUser = null;
let authorizationInProgress = false;
let toastTimeout;

const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const callableErrorCode = (error) => String(error?.code || "").replace(/^functions\//, "");

const callableErrorMessage = (error, fallback = "操作失敗，請稍後再試") => {
    const code = callableErrorCode(error);
    if (code === "unauthenticated") return "請重新登入管理員帳號";
    if (code === "permission-denied") return "這個帳號沒有管理員權限";
    if (code === "not-found") return error?.message || "找不到指定資料";
    if (code === "unavailable") return "目前無法連上伺服器，請檢查網路後再試";
    return error?.message || fallback;
};

const showToast = (message) => {
    const toast = document.getElementById("toast");
    toast.textContent = String(message ?? "");
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
};

const showLogin = () => {
    loading.hidden = true;
    dashboard.hidden = true;
    login.hidden = false;
};

const rejectAccess = () => {
    sessionStorage.setItem("adminAccessError", "這個 Google 帳號沒有管理員權限");
    window.location.replace("/?adminError=no-access");
};

const toLocalDateTimeInput = (date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
};

const formatCampaignTime = (millis) => {
    if (!millis) return "未設定";
    return new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(millis));
};

const initializeCampaignTimes = () => {
    const start = new Date();
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    document.getElementById("admin-campaign-start").value ||= toLocalDateTimeInput(start);
    document.getElementById("admin-campaign-end").value ||= toLocalDateTimeInput(end);
};

const adminRoutes = {
    "/admin/users": {title: "使用者與權限", load: () => loadAdminUsers()},
    "/admin/qr": {title: "QR code", load: () => loadQrCampaigns()},
    "/admin/wishes": {title: "許願池", load: async () => {}}
};

const normalizeAdminRoute = (path) => {
    const normalized = path.replace(/\/$/, "");
    return adminRoutes[normalized] ? normalized : "/admin/users";
};

const showAdminRoute = async (path, historyMode = "none") => {
    const route = normalizeAdminRoute(path);
    if (historyMode === "push") window.history.pushState({}, "", route);
    if (historyMode === "replace" || route !== path.replace(/\/$/, "")) {
        window.history.replaceState({}, "", route);
    }
    document.querySelectorAll("[data-admin-view]").forEach((view) => {
        view.hidden = view.dataset.adminView !== route;
    });
    document.querySelectorAll("[data-admin-route]").forEach((link) => {
        link.classList.toggle("active", link.dataset.adminRoute === route);
    });
    document.getElementById("admin-page-title").textContent = adminRoutes[route].title;
    await adminRoutes[route].load();
};

const showDashboard = async (user) => {
    document.getElementById("admin-account").textContent = user.email || "已登入";
    loading.hidden = true;
    login.hidden = true;
    dashboard.hidden = false;
    initializeCampaignTimes();
    await showAdminRoute(window.location.pathname, "replace");
};

const authorizeUser = async (user) => {
    if (authorizationInProgress) return;
    authorizationInProgress = true;
    loading.hidden = false;
    login.hidden = true;
    try {
        let profile = (await callGetMyProfile()).data || {};
        if (!profile.isAdmin && profile.canBootstrapSuperAdmin) {
            await callBootstrapSuperAdmin();
            await user.getIdToken(true);
            profile = (await callGetMyProfile()).data || {};
        }
        if (!profile.isAdmin) {
            rejectAccess();
            return;
        }
        await showDashboard(user);
    } catch (error) {
        console.error("確認管理員權限失敗：", error);
        if (["permission-denied", "failed-precondition"].includes(callableErrorCode(error))) {
            rejectAccess();
            return;
        }
        showLogin();
        showToast(callableErrorMessage(error, "無法確認管理員權限"));
    } finally {
        authorizationInProgress = false;
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        authorizeUser(user);
    } else {
        showLogin();
    }
});

document.getElementById("google-admin-login").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Google 管理員登入失敗：", error);
        if (error?.code !== "auth/popup-closed-by-user") {
            showToast(error?.code === "auth/popup-blocked"
                ? "瀏覽器阻擋了登入視窗，請允許彈出式視窗"
                : "Google 登入失敗，請稍後再試");
        }
    } finally {
        button.disabled = false;
    }
});

document.getElementById("admin-logout").addEventListener("click", async () => {
    await signOut(auth);
    window.location.replace("/");
});

const showQrPreview = (campaign) => {
    currentQrDownload = campaign;
    const card = document.getElementById("qr-preview-card");
    card.hidden = false;
    document.getElementById("qr-preview-title").textContent = `${campaign.title} QR code`;
    document.getElementById("qr-preview-image").innerHTML = campaign.svg;
    const link = document.getElementById("qr-preview-url");
    link.href = campaign.url;
    link.textContent = campaign.url;
    card.scrollIntoView({behavior: "smooth", block: "start"});
};

const loadQrCampaigns = async () => {
    const list = document.getElementById("admin-campaign-list");
    list.innerHTML = '<p class="empty-history">正在載入活動⋯⋯</p>';
    try {
        const response = await callListQrCampaigns();
        const campaigns = Array.isArray(response.data) ? response.data : [];
        if (!campaigns.length) {
            list.innerHTML = '<p class="empty-history">尚未建立活動 QR code。</p>';
            return;
        }
        list.innerHTML = campaigns.map((campaign) => `
            <div class="campaign-item" data-campaign-id="${escapeHtml(campaign.id)}">
                <div class="campaign-item-heading">
                    <div class="campaign-title">${escapeHtml(campaign.title)}</div>
                    <span class="campaign-status ${campaign.active ? "active" : ""}">${campaign.active ? "啟用中" : "已停用"}</span>
                </div>
                <div class="campaign-meta">
                    ${Number(campaign.points)} 點<br>
                    ${escapeHtml(formatCampaignTime(campaign.startsAt))}～${escapeHtml(formatCampaignTime(campaign.endsAt))}
                </div>
                <div class="campaign-actions">
                    <button class="small-action-btn show-campaign-qr">查看 QR code</button>
                    <button class="small-action-btn toggle-campaign" data-active="${String(!campaign.active)}">${campaign.active ? "停用" : "重新啟用"}</button>
                </div>
            </div>
        `).join("");
        list.querySelectorAll(".show-campaign-qr").forEach((button) => {
            button.addEventListener("click", async () => {
                const campaignId = button.closest("[data-campaign-id]").dataset.campaignId;
                try {
                    showQrPreview((await callGetQrCampaign({campaignId})).data);
                } catch (error) {
                    showToast(callableErrorMessage(error, "無法取得 QR code"));
                }
            });
        });
        list.querySelectorAll(".toggle-campaign").forEach((button) => {
            button.addEventListener("click", async () => {
                const campaignId = button.closest("[data-campaign-id]").dataset.campaignId;
                const active = button.dataset.active === "true";
                button.disabled = true;
                try {
                    await callSetQrCampaignStatus({campaignId, active});
                    showToast(active ? "活動已重新啟用" : "活動已停用");
                    await loadQrCampaigns();
                } catch (error) {
                    showToast(callableErrorMessage(error, "活動狀態更新失敗"));
                    button.disabled = false;
                }
            });
        });
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, "活動列表載入失敗"))}</p>`;
    }
};

document.getElementById("create-campaign").addEventListener("click", async (event) => {
    const title = document.getElementById("admin-campaign-title").value.trim();
    const points = Number(document.getElementById("admin-campaign-points").value);
    const startsAt = new Date(document.getElementById("admin-campaign-start").value).getTime();
    const endsAt = new Date(document.getElementById("admin-campaign-end").value).getTime();
    if (!title || !Number.isInteger(points) || !startsAt || !endsAt) {
        showToast("請完整填寫活動名稱、點數與時間");
        return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const response = await callCreateQrCampaign({title, points, startsAt, endsAt});
        showQrPreview(response.data);
        document.getElementById("admin-campaign-title").value = "";
        showToast("活動 QR code 已建立");
        await loadQrCampaigns();
    } catch (error) {
        showToast(callableErrorMessage(error, "建立 QR code 失敗"));
    } finally {
        button.disabled = false;
    }
});

document.getElementById("download-qr").addEventListener("click", () => {
    if (!currentQrDownload?.svg) return;
    const objectUrl = URL.createObjectURL(new Blob([currentQrDownload.svg], {type: "image/svg+xml;charset=utf-8"}));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${currentQrDownload.title || "活動"}-QR-code.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
});

const renderAdminUser = (user) => {
    const container = document.getElementById("admin-user-result");
    if (!user) {
        container.innerHTML = "";
        return;
    }
    const roleLabel = user.isAdmin ? "管理員" : "一般使用者";
    const actionDisabled = user.isSuperAdmin || user.disabled;
    container.innerHTML = `
        <div class="campaign-item role-user-item">
            <div class="campaign-item-heading">
                <div>
                    <div class="campaign-title">${escapeHtml(user.displayName || user.email)}</div>
                    <div class="campaign-meta">${escapeHtml(user.email)}<br>${escapeHtml(roleLabel)}${user.disabled ? "・帳號已停用" : ""}</div>
                </div>
                <span class="campaign-status ${user.isAdmin ? "active" : ""}">${escapeHtml(roleLabel)}</span>
            </div>
            <div class="campaign-actions">
                <button id="change-selected-role" class="small-action-btn" ${actionDisabled ? "disabled" : ""}>${user.isAdmin ? "撤銷管理員" : "設為管理員"}</button>
            </div>
        </div>`;
    document.getElementById("change-selected-role")?.addEventListener("click", () => {
        setSelectedAdminRole(!user.isAdmin);
    });
};

const lookupAdminUser = async () => {
    const input = document.getElementById("admin-user-email");
    const email = input.value.trim();
    if (!email) {
        showToast("請輸入電子郵件");
        return;
    }
    const button = document.getElementById("lookup-admin-user");
    button.disabled = true;
    try {
        selectedAdminUser = (await callLookupAdminUser({email})).data;
        renderAdminUser(selectedAdminUser);
    } catch (error) {
        selectedAdminUser = null;
        renderAdminUser(null);
        showToast(callableErrorMessage(error, "查詢使用者失敗"));
    } finally {
        button.disabled = false;
    }
};

const setSelectedAdminRole = async (admin) => {
    if (!selectedAdminUser?.email) return;
    if (!admin && !window.confirm(`確定要撤銷 ${selectedAdminUser.email} 的管理員權限嗎？`)) return;
    try {
        selectedAdminUser = (await callSetAdminRole({
            email: selectedAdminUser.email,
            admin
        })).data;
        renderAdminUser(selectedAdminUser);
        showToast(admin ? "已授予管理員權限，請通知對方重新登入" : "已撤銷管理員權限");
        await loadAdminUsers();
    } catch (error) {
        showToast(callableErrorMessage(error, "更新管理員權限失敗"));
    }
};

const loadAdminUsers = async () => {
    const list = document.getElementById("admin-user-list");
    list.innerHTML = '<p class="empty-history">正在載入管理員⋯⋯</p>';
    try {
        const response = await callListUsers();
        const users = Array.isArray(response.data) ? response.data : [];
        list.innerHTML = users.length ? users.map((user) => `
            <div class="campaign-item role-user-item" data-email="${escapeHtml(user.email)}">
                <div class="campaign-item-heading">
                    <div>
                        <div class="campaign-title">${escapeHtml(user.displayName || user.email)}</div>
                        <div class="campaign-meta">${escapeHtml(user.email)}</div>
                    </div>
                    <span class="campaign-status ${user.isAdmin ? "active" : ""}">${user.isAdmin ? "管理員" : "一般使用者"}</span>
                </div>
                ${user.isSuperAdmin ? "" : '<div class="campaign-actions"><button class="small-action-btn manage-role">管理權限</button></div>'}
            </div>
        `).join("") : '<p class="empty-history">目前沒有使用者。</p>';
        list.querySelectorAll(".manage-role").forEach((button) => {
            button.addEventListener("click", () => {
                document.getElementById("admin-user-email").value = button.closest("[data-email]").dataset.email;
                lookupAdminUser();
            });
        });
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, "管理員列表載入失敗"))}</p>`;
    }
};

document.getElementById("lookup-admin-user").addEventListener("click", lookupAdminUser);
document.getElementById("admin-user-email").addEventListener("keydown", (event) => {
    if (event.key === "Enter") lookupAdminUser();
});
document.getElementById("refresh-campaigns").addEventListener("click", loadQrCampaigns);
document.getElementById("refresh-admins").addEventListener("click", loadAdminUsers);
document.querySelectorAll("[data-admin-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        showAdminRoute(link.dataset.adminRoute, "push");
    });
});
window.addEventListener("popstate", () => showAdminRoute(window.location.pathname));
