import {initializeApp} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
    connectAuthEmulator,
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

const useLocalEmulators = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const productionFirebaseConfig = {
    apiKey: "AIzaSyD4tdUd6o06zxMyyOq8CwyZuixrIh5j0Kk",
    authDomain: "coespark-a3f6e.firebaseapp.com",
    projectId: "coespark-a3f6e",
    storageBucket: "coespark-a3f6e.firebasestorage.app",
    messagingSenderId: "495581170629",
    appId: "1:495581170629:web:aba68ff657942cf77b99ac",
    measurementId: "G-7WB0WT0QP1"
};
const firebaseConfig = useLocalEmulators
    ? {
        ...productionFirebaseConfig,
        authDomain: "demo-eduspark.firebaseapp.com",
        projectId: "demo-eduspark",
        storageBucket: "demo-eduspark.appspot.com"
    }
    : productionFirebaseConfig;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, "asia-east1");
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: "select_account"});

if (useLocalEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings: true});
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
const callUpdateQrCampaign = httpsCallable(functions, "updateQrCampaign");
const callListQrCampaigns = httpsCallable(functions, "listQrCampaigns");
const callGetQrCampaign = httpsCallable(functions, "getQrCampaign");
const callSetQrCampaignStatus = httpsCallable(functions, "setQrCampaignStatus");
const callListUsers = httpsCallable(functions, "listUsers");
const callSetAdminRole = httpsCallable(functions, "setAdminRole");
const callListWishes = httpsCallable(functions, "listWishes");
const callReplyWish = httpsCallable(functions, "replyWish");
const callDeleteWish = httpsCallable(functions, "deleteWish");
const callListAnnouncements = httpsCallable(functions, "listAnnouncements");
const callSaveAnnouncement = httpsCallable(functions, "saveAnnouncement");
const callDeleteAnnouncement = httpsCallable(functions, "deleteAnnouncement");
const callBatchAddPoints = httpsCallable(functions, "batchAddPoints");

const loading = document.getElementById("admin-loading");
const login = document.getElementById("admin-login");
const dashboard = document.getElementById("admin-dashboard");
let currentQrDownload = null;
let editingCampaignId = null;
let selectedAdminUser = null;
let authorizationInProgress = false;
let adminUsers = [];
let adminWishes = [];
const selectedPointUserIds = new Set();
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

const openAdminModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("admin-modal-open");
    modal.querySelector("input:not([type='hidden']), button, [contenteditable='true']")?.focus();
};

const closeAdminModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = true;
    if (!document.querySelector(".admin-modal:not([hidden])")) {
        document.body.classList.remove("admin-modal-open");
    }
};

document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeAdminModal(button.dataset.closeModal));
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const activeModal = document.querySelector(".admin-modal:not([hidden])");
    if (activeModal) closeAdminModal(activeModal.id);
});

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

const wishCategoryLabels = {suggestion: "建議", feedback: "回饋", curiosity: "好奇"};

const initializeCampaignTimes = () => {
    const start = new Date();
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    document.getElementById("admin-campaign-start").value ||= toLocalDateTimeInput(start);
    document.getElementById("admin-campaign-end").value ||= toLocalDateTimeInput(end);
};

const resetCampaignForm = () => {
    editingCampaignId = null;
    document.getElementById("campaign-form-title").textContent = "新增活動 QR code";
    document.getElementById("save-campaign").textContent = "建立 QR code";
    document.getElementById("admin-campaign-title").value = "";
    document.getElementById("admin-campaign-description").value = "";
    document.getElementById("admin-campaign-points").value = "2";
    document.getElementById("admin-campaign-points").disabled = false;
    document.getElementById("campaign-points-lock-note").hidden = true;
    document.getElementById("admin-campaign-start").value = "";
    document.getElementById("admin-campaign-end").value = "";
    initializeCampaignTimes();
};

const openCampaignEditor = async (campaignId) => {
    try {
        const campaign = (await callGetQrCampaign({campaignId})).data;
        editingCampaignId = campaign.id;
        document.getElementById("campaign-form-title").textContent = "編輯活動";
        document.getElementById("save-campaign").textContent = "儲存修改";
        document.getElementById("admin-campaign-title").value = campaign.title || "";
        document.getElementById("admin-campaign-description").value = campaign.description || "";
        document.getElementById("admin-campaign-points").value = String(campaign.points || 1);
        document.getElementById("admin-campaign-points").disabled = campaign.hasRedemptions === true;
        document.getElementById("campaign-points-lock-note").hidden = campaign.hasRedemptions !== true;
        document.getElementById("admin-campaign-start").value = toLocalDateTimeInput(new Date(campaign.startsAt));
        document.getElementById("admin-campaign-end").value = toLocalDateTimeInput(new Date(campaign.endsAt));
        openAdminModal("campaign-form-modal");
    } catch (error) {
        showToast(callableErrorMessage(error, "無法載入活動資料"));
    }
};

const adminRoutes = {
    "/admin/users": {title: "使用者與權限", load: () => loadAdminUsers()},
    "/admin/qr": {title: "QR code", load: () => loadQrCampaigns()},
    "/admin/wishes": {title: "許願池", load: () => loadAdminWishes()},
    "/admin/announcements": {title: "公佈欄", load: () => loadAnnouncements()}
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
        await user.getIdToken(true);
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
    document.getElementById("qr-preview-title").textContent = `${campaign.title} QR code`;
    document.getElementById("qr-preview-image").innerHTML = campaign.svg;
    const link = document.getElementById("qr-preview-url");
    link.href = campaign.url;
    link.textContent = campaign.url;
    openAdminModal("qr-preview-modal");
};

const loadQrCampaigns = async () => {
    const list = document.getElementById("admin-campaign-list");
    list.innerHTML = '<p class="empty-history">正在載入活動⋯⋯</p>';
    try {
        const response = await callListQrCampaigns();
        const campaigns = Array.isArray(response.data) ? response.data : [];
        window.renderAdminCampaigns(campaigns);
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, "活動列表載入失敗"))}</p>`;
    }
};

window.renderAdminCampaigns = (campaigns = []) => {
    const list = document.getElementById("admin-campaign-list");
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
                <p class="admin-wish-message">${escapeHtml(campaign.description || "尚無活動內文")}</p>
                <div class="campaign-actions">
                    <button class="small-action-btn edit-campaign">編輯</button>
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
    list.querySelectorAll(".edit-campaign").forEach((button) => {
        button.addEventListener("click", () => {
            openCampaignEditor(button.closest("[data-campaign-id]").dataset.campaignId);
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
};

document.getElementById("save-campaign").addEventListener("click", async (event) => {
    const title = document.getElementById("admin-campaign-title").value.trim();
    const description = document.getElementById("admin-campaign-description").value;
    const points = Number(document.getElementById("admin-campaign-points").value);
    const startsAt = new Date(document.getElementById("admin-campaign-start").value).getTime();
    const endsAt = new Date(document.getElementById("admin-campaign-end").value).getTime();
    if (!title || !description.trim() || !Number.isInteger(points) || !startsAt || !endsAt) {
        showToast("請完整填寫活動名稱、內文、點數與時間");
        return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const response = editingCampaignId
            ? await callUpdateQrCampaign({campaignId: editingCampaignId, title, description, points, startsAt, endsAt})
            : await callCreateQrCampaign({title, description, points, startsAt, endsAt});
        const wasEditing = Boolean(editingCampaignId);
        closeAdminModal("campaign-form-modal");
        if (!wasEditing) showQrPreview(response.data);
        showToast(wasEditing ? "活動資料已更新" : "活動 QR code 已建立");
        resetCampaignForm();
        await loadQrCampaigns();
    } catch (error) {
        showToast(callableErrorMessage(error, editingCampaignId ? "更新活動失敗" : "建立 QR code 失敗"));
    } finally {
        button.disabled = false;
    }
});

document.getElementById("open-campaign-form").addEventListener("click", () => {
    resetCampaignForm();
    openAdminModal("campaign-form-modal");
});

document.getElementById("download-qr").addEventListener("click", () => {
    if (!currentQrDownload?.pngDataUrl) return;
    const link = document.createElement("a");
    link.href = currentQrDownload.pngDataUrl;
    link.download = `${currentQrDownload.title || "活動"}-QR-code.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
});

const setSelectedAdminRole = async (admin) => {
    if (!selectedAdminUser?.email) return;
    if (!admin && !window.confirm(`確定要撤銷 ${selectedAdminUser.email} 的管理員權限嗎？`)) return;
    try {
        const role = (await callSetAdminRole({
            email: selectedAdminUser.email,
            admin
        })).data;
        selectedAdminUser = {...selectedAdminUser, ...role};
        showToast(admin ? "已授予管理員權限，對方重新開啟後台即可生效" : "已撤銷管理員權限");
        await loadAdminUsers(document.getElementById("admin-user-query").value.trim());
        const updatedUser = adminUsers.find((user) => user.uid === selectedAdminUser.uid);
        if (updatedUser) showUserDetail(updatedUser.uid);
    } catch (error) {
        showToast(callableErrorMessage(error, "更新管理員權限失敗"));
    }
};

window.renderAdminUsers = (users, query = "") => {
    const list = document.getElementById("admin-user-list");
    adminUsers = Array.isArray(users) ? users : [];
    selectedPointUserIds.clear();
    updateSelectedUserCount();
    list.innerHTML = adminUsers.length ? adminUsers.map((user) => `
            <div class="admin-user-row" data-uid="${escapeHtml(user.uid)}">
                <label class="admin-user-select" title="${user.realName ? "選擇使用者" : "尚未建立個人檔案"}">
                    <input class="point-user-checkbox" type="checkbox" aria-label="選擇 ${escapeHtml(user.realName || user.email)}" ${user.realName ? "" : "disabled"}>
                </label>
                <button type="button" class="admin-user-row-content view-user-detail" aria-label="查看 ${escapeHtml(user.realName || user.nickname || user.email)} 的詳細資料">
                    <span class="admin-user-name"><strong>${escapeHtml(user.realName || user.nickname || user.displayName || "尚未建立檔案")}</strong><small>${escapeHtml(user.nickname || "")}</small></span>
                    <span class="admin-user-email">${escapeHtml(user.email)}</span>
                    <span>${Number(user.points || 0)} 點</span>
                    <span class="campaign-status ${user.isAdmin ? "active" : ""}">${user.isAdmin ? "管理員" : "一般使用者"}</span>
                    <span class="admin-row-arrow" aria-hidden="true">›</span>
                </button>
            </div>
        `).join("") : `<p class="empty-history">${query ? "找不到符合條件的使用者。" : "目前沒有使用者。"}</p>`;
    list.querySelectorAll(".view-user-detail").forEach((button) => {
        button.addEventListener("click", () => showUserDetail(button.closest("[data-uid]").dataset.uid));
    });
    list.querySelectorAll(".point-user-checkbox").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
            const uid = checkbox.closest("[data-uid]").dataset.uid;
            if (checkbox.checked) selectedPointUserIds.add(uid); else selectedPointUserIds.delete(uid);
            updateSelectedUserCount();
        });
    });
};

const loadAdminUsers = async (query = document.getElementById("admin-user-query")?.value.trim() || "") => {
    const list = document.getElementById("admin-user-list");
    list.innerHTML = '<p class="empty-history">正在載入使用者⋯⋯</p>';
    try {
        const response = await callListUsers({query});
        window.renderAdminUsers(response.data, query);
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, "管理員列表載入失敗"))}</p>`;
    }
};

const updateSelectedUserCount = () => {
    const count = document.getElementById("selected-user-count");
    if (count) count.textContent = `已選擇 ${selectedPointUserIds.size} 位使用者`;
    const modalCount = document.getElementById("point-adjustment-selection");
    if (modalCount) modalCount.textContent = `已選擇 ${selectedPointUserIds.size} 位使用者`;
    document.getElementById("open-point-adjustment").disabled = selectedPointUserIds.size === 0;
};

const showUserDetail = (uid) => {
    const user = adminUsers.find((item) => item.uid === uid);
    if (!user) return;
    selectedAdminUser = user;
    const detail = document.getElementById("admin-user-detail");
    detail.innerHTML = `
        <div class="admin-inline-heading"><h2 id="admin-user-detail-title">使用者詳細資料</h2><button type="button" class="admin-modal-close" data-close-modal="admin-user-detail-modal" aria-label="關閉">×</button></div>
        <div class="admin-modal-body">
        <dl class="user-detail-grid">
            <div><dt>真實姓名</dt><dd>${escapeHtml(user.realName || "尚未建立個人檔案")}</dd></div>
            <div><dt>公開暱稱</dt><dd>${escapeHtml(user.nickname || "—")}</dd></div>
            <div><dt>電子郵件</dt><dd>${escapeHtml(user.email)}</dd></div>
            <div><dt>系級</dt><dd>${escapeHtml(user.dept || "—")}</dd></div>
            <div><dt>目前／累積點數</dt><dd>${Number(user.points || 0)}／${Number(user.totalPoints || 0)}</dd></div>
            <div><dt>自我介紹</dt><dd>${escapeHtml(user.bio || "—")}</dd></div>
            <div><dt>最近登入</dt><dd>${escapeHtml(formatCampaignTime(user.lastSignInAt))}</dd></div>
        </dl>
        <div class="admin-detail-actions">
            <button id="change-selected-role" class="admin-secondary-button" ${user.isSuperAdmin || user.disabled ? "disabled" : ""}>${user.isAdmin ? "撤銷管理員" : "設為管理員"}</button>
        </div></div>`;
    detail.querySelector("[data-close-modal]").addEventListener("click", () => closeAdminModal("admin-user-detail-modal"));
    detail.querySelector("#change-selected-role")?.addEventListener("click", () => setSelectedAdminRole(!user.isAdmin));
    openAdminModal("admin-user-detail-modal");
};

document.getElementById("batch-add-points").addEventListener("click", async (event) => {
    const points = Number(document.getElementById("batch-points").value);
    const reason = document.getElementById("batch-points-reason").value.trim();
    if (!selectedPointUserIds.size) return showToast("請先勾選至少一位使用者");
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000) return showToast("請輸入 -1000 至 1000 之間的非零整數");
    if (!reason) return showToast("請輸入調整積分的理由");
    const button = event.currentTarget;
    button.disabled = true;
    try {
        const response = await callBatchAddPoints({userIds: [...selectedPointUserIds], points, reason});
        showToast(`已為 ${response.data.updated} 位使用者${points > 0 ? "新增" : "扣除"} ${Math.abs(points)} 點`);
        document.getElementById("batch-points-reason").value = "";
        closeAdminModal("point-adjustment-modal");
        await loadAdminUsers(document.getElementById("admin-user-query").value.trim());
    } catch (error) {
        showToast(callableErrorMessage(error, "調整積分失敗"));
    } finally {
        button.disabled = false;
    }
});

document.getElementById("admin-user-search").addEventListener("submit", (event) => {
    event.preventDefault();
    loadAdminUsers(document.getElementById("admin-user-query").value.trim());
});

document.getElementById("clear-admin-user-search").addEventListener("click", () => {
    document.getElementById("admin-user-query").value = "";
    loadAdminUsers("");
});

document.getElementById("open-point-adjustment").addEventListener("click", () => {
    if (!selectedPointUserIds.size) return;
    updateSelectedUserCount();
    openAdminModal("point-adjustment-modal");
});

const formatWishTime = (millis) => {
    if (!millis) return "未知時間";
    return new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(millis));
};

const loadAdminWishes = async () => {
    const list = document.getElementById("admin-wish-list");
    list.innerHTML = '<p class="empty-history">正在載入留言⋯⋯</p>';
    try {
        const response = await callListWishes();
        const responseWishes = Array.isArray(response.data) ? response.data : [];
        adminWishes = responseWishes;
        renderAdminWishes();
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, "留言列表載入失敗"))}</p>`;
    }
};

const renderAdminWishes = () => {
    const list = document.getElementById("admin-wish-list");
    const filter = document.getElementById("admin-wish-filter").value;
    const wishes = filter === "all" ? adminWishes : adminWishes.filter((wish) => wish.category === filter);
    list.innerHTML = wishes.length ? wishes.map((wish) => `
            <article class="campaign-item admin-wish-item" data-wish-id="${escapeHtml(wish.id)}">
                <div class="campaign-item-heading">
                    <div>
                        <div class="campaign-title">${escapeHtml(wish.authorName)}</div>
                        <div class="campaign-meta">${escapeHtml(formatWishTime(wish.createdAt))}</div>
                    </div>
                    <span class="campaign-status">${escapeHtml(wishCategoryLabels[wish.category] || "建議")}${wish.anonymous ? "・匿名" : ""}</span>
                </div>
                <p class="admin-wish-message">${escapeHtml(wish.message)}</p>
                ${wish.adminReply ? `
                    <div class="admin-wish-existing-reply">
                        <strong>管理員回覆</strong>
                        <p>${escapeHtml(wish.adminReply)}</p>
                        ${wish.repliedAt ? `<time>${escapeHtml(formatWishTime(wish.repliedAt))}</time>` : ""}
                    </div>` : ""}
                <div class="admin-wish-reply-form">
                    <label for="wish-reply-${escapeHtml(wish.id)}">${wish.adminReply ? "更新回覆" : "回覆留言"}</label>
                    <textarea id="wish-reply-${escapeHtml(wish.id)}" class="wish-reply-input" maxlength="1000" rows="3" placeholder="輸入要顯示在前台的回覆">${escapeHtml(wish.adminReply || "")}</textarea>
                </div>
                <div class="campaign-actions">
                    <button type="button" class="small-action-btn save-wish-reply">${wish.adminReply ? "更新回覆" : "送出回覆"}</button>
                    <button type="button" class="small-action-btn delete-wish">刪除留言</button>
                </div>
            </article>
        `).join("") : '<p class="empty-history">這個標籤目前沒有留言。</p>';
};

const announcementCategoryLabels = {
    general: "重要公告",
    event: "活動消息",
    update: "功能更新",
    reward: "兌換活動"
};
let adminAnnouncements = [];
const plainTextHtml = (content) => escapeHtml(content).replaceAll("\n", "<br>");

const resetAnnouncementForm = () => {
    document.getElementById("announcement-id").value = "";
    document.getElementById("announcement-title").value = "";
    document.getElementById("announcement-category").value = "general";
    document.getElementById("announcement-content").innerHTML = "";
    document.getElementById("announcement-published").checked = true;
    document.getElementById("announcement-form-title").textContent = "新增公告";
    document.getElementById("save-announcement").textContent = "儲存公告";
    document.getElementById("cancel-announcement-edit").hidden = true;
};

const editAnnouncement = (announcementId) => {
    const announcement = adminAnnouncements.find((item) => item.id === announcementId);
    if (!announcement) return;
    document.getElementById("announcement-id").value = announcement.id;
    document.getElementById("announcement-title").value = announcement.title;
    document.getElementById("announcement-category").value = announcement.category;
    document.getElementById("announcement-content").innerHTML = announcement.contentHtml || plainTextHtml(announcement.content);
    document.getElementById("announcement-published").checked = announcement.published;
    document.getElementById("announcement-form-title").textContent = "編輯公告";
    document.getElementById("save-announcement").textContent = "更新公告";
    document.getElementById("cancel-announcement-edit").hidden = false;
    openAdminModal("announcement-form-modal");
    document.getElementById("announcement-title").focus();
};

const loadAnnouncements = async () => {
    const list = document.getElementById("admin-announcement-list");
    list.innerHTML = '<p class="empty-history">正在載入公告⋯⋯</p>';
    try {
        const response = await callListAnnouncements();
        adminAnnouncements = Array.isArray(response.data) ? response.data : [];
        list.innerHTML = adminAnnouncements.length ? adminAnnouncements.map((announcement) => `
            <article class="campaign-item admin-announcement-item" data-announcement-id="${escapeHtml(announcement.id)}">
                <div class="campaign-item-heading">
                    <div>
                        <div class="campaign-title">${escapeHtml(announcement.title)}</div>
                        <div class="campaign-meta">${escapeHtml(announcementCategoryLabels[announcement.category] || "重要公告")}・${escapeHtml(formatWishTime(announcement.updatedAt))}</div>
                    </div>
                    <span class="campaign-status ${announcement.published ? "active" : ""}">${announcement.published ? "已發佈" : "草稿"}</span>
                </div>
                <div class="admin-wish-message admin-rich-preview">${announcement.contentHtml || plainTextHtml(announcement.content)}</div>
                <div class="campaign-actions">
                    <button type="button" class="small-action-btn edit-announcement">編輯</button>
                    <button type="button" class="small-action-btn delete-announcement">刪除</button>
                </div>
            </article>
        `).join("") : '<p class="empty-history">目前還沒有公告。</p>';
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, "公告列表載入失敗"))}</p>`;
    }
};

document.getElementById("save-announcement").addEventListener("click", async (event) => {
    const id = document.getElementById("announcement-id").value;
    const title = document.getElementById("announcement-title").value.trim();
    const contentHtml = document.getElementById("announcement-content").innerHTML.trim();
    const content = document.getElementById("announcement-content").innerText.trim();
    const category = document.getElementById("announcement-category").value;
    const published = document.getElementById("announcement-published").checked;
    if (!title || !content) {
        showToast("請填寫公告標題與內容");
        return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
        await callSaveAnnouncement({id, title, contentHtml, category, published});
        showToast(id ? "公告已更新" : published ? "公告已發佈" : "草稿已儲存");
        closeAdminModal("announcement-form-modal");
        resetAnnouncementForm();
        await loadAnnouncements();
    } catch (error) {
        showToast(callableErrorMessage(error, "公告儲存失敗"));
    } finally {
        button.disabled = false;
    }
});

document.getElementById("cancel-announcement-edit").addEventListener("click", () => {
    closeAdminModal("announcement-form-modal");
    resetAnnouncementForm();
});

document.getElementById("open-announcement-form").addEventListener("click", () => {
    resetAnnouncementForm();
    openAdminModal("announcement-form-modal");
});

document.querySelectorAll(".wysiwyg-toolbar [data-command]").forEach((button) => {
    button.addEventListener("click", () => {
        const command = button.dataset.command;
        const editor = document.getElementById("announcement-content");
        editor.focus();
        if (command === "createLink") {
            const url = window.prompt("請輸入連結網址（https://…）");
            if (!url) return;
            try {
                const parsed = new URL(url);
                if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid");
                document.execCommand(command, false, parsed.toString());
            } catch {
                showToast("請輸入有效的 http 或 https 網址");
            }
            return;
        }
        if (command === "insertImage") {
            const url = window.prompt("請輸入圖片網址（僅支援 https://）");
            if (!url) return;
            try {
                const parsed = new URL(url);
                if (parsed.protocol !== "https:") throw new Error("invalid");
                const alt = window.prompt("請輸入圖片替代文字（可留白）") ?? "";
                document.execCommand(command, false, parsed.toString());
                const insertedImage = [...editor.querySelectorAll("img")]
                    .reverse()
                    .find((image) => image.src === parsed.toString());
                if (insertedImage) {
                    insertedImage.alt = alt.trim().slice(0, 200);
                    insertedImage.loading = "lazy";
                }
            } catch {
                showToast("請輸入有效的 https 圖片網址");
            }
            return;
        }
        document.execCommand(command, false);
    });
});

document.getElementById("admin-announcement-list").addEventListener("click", async (event) => {
    const item = event.target.closest("[data-announcement-id]");
    if (!item) return;
    if (event.target.closest(".edit-announcement")) {
        editAnnouncement(item.dataset.announcementId);
        return;
    }
    const button = event.target.closest(".delete-announcement");
    if (!button) return;
    if (button.dataset.confirmed !== "true") {
        button.dataset.confirmed = "true";
        button.textContent = "再按一次確認刪除";
        button.classList.add("confirming");
        setTimeout(() => {
            if (!button.isConnected || button.disabled) return;
            button.dataset.confirmed = "false";
            button.textContent = "刪除";
            button.classList.remove("confirming");
        }, 5000);
        return;
    }
    button.disabled = true;
    try {
        await callDeleteAnnouncement({id: item.dataset.announcementId});
        showToast("公告已刪除");
        if (document.getElementById("announcement-id").value === item.dataset.announcementId) {
            resetAnnouncementForm();
        }
        await loadAnnouncements();
    } catch (error) {
        showToast(callableErrorMessage(error, "公告刪除失敗"));
        button.disabled = false;
    }
});

document.getElementById("admin-wish-list").addEventListener("click", async (event) => {
    const replyButton = event.target.closest(".save-wish-reply");
    if (replyButton) {
        const item = replyButton.closest("[data-wish-id]");
        const input = item?.querySelector(".wish-reply-input");
        const reply = input?.value.trim();
        if (!item || !reply) {
            showToast("請輸入回覆內容");
            return;
        }
        replyButton.disabled = true;
        try {
            const result = (await callReplyWish({wishId: item.dataset.wishId, reply})).data;
            adminWishes = adminWishes.map((wish) => wish.id === item.dataset.wishId
                ? {...wish, adminReply: result.adminReply, repliedAt: result.repliedAt}
                : wish);
            renderAdminWishes();
            showToast("回覆已送出");
        } catch (error) {
            showToast(callableErrorMessage(error, "回覆送出失敗"));
            replyButton.disabled = false;
        }
        return;
    }
    const button = event.target.closest(".delete-wish");
    if (!button) return;
    const item = button.closest("[data-wish-id]");
    if (!item) return;
    if (button.dataset.confirmed !== "true") {
        button.dataset.confirmed = "true";
        button.textContent = "再按一次確認刪除";
        button.classList.add("confirming");
        setTimeout(() => {
            if (!button.isConnected || button.disabled) return;
            button.dataset.confirmed = "false";
            button.textContent = "刪除留言";
            button.classList.remove("confirming");
        }, 5000);
        return;
    }

    button.disabled = true;
    button.textContent = "刪除中⋯⋯";
    try {
        await callDeleteWish({wishId: item.dataset.wishId});
        adminWishes = adminWishes.filter((wish) => wish.id !== item.dataset.wishId);
        item.remove();
        showToast("留言已刪除");
        const list = document.getElementById("admin-wish-list");
        if (!list.querySelector("[data-wish-id]")) {
            list.innerHTML = '<p class="empty-history">目前還沒有留言。</p>';
        }
    } catch (error) {
        showToast(callableErrorMessage(error, "留言刪除失敗"));
        button.disabled = false;
        button.dataset.confirmed = "false";
        button.textContent = "刪除留言";
        button.classList.remove("confirming");
    }
});

document.getElementById("admin-wish-filter").addEventListener("change", renderAdminWishes);
document.querySelectorAll("[data-admin-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        showAdminRoute(link.dataset.adminRoute, "push");
    });
});
window.addEventListener("popstate", () => showAdminRoute(window.location.pathname));
