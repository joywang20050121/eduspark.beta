import {expect, test} from '@playwright/test';

const openApp = async (page) => {
    await page.goto('/');
    await expect(page.locator('#loading-overlay')).toBeHidden();
};

test('訪客可以進入首頁', async ({page}) => {
    await openApp(page);

    await expect(page.getByRole('button', {name: '使用 Google 帳號登入'})).toBeVisible();
    await page.getByRole('button', {name: '訪客遊玩'}).click();

    await expect(page.locator('#view-home')).toHaveClass(/active/);
    await expect(page.locator('#main-nav')).toBeVisible();
    await expect(page.getByRole('button', {name: '掃描累積點數'})).toBeVisible();
});

test('沒有公告時顯示敬請期待', async ({page}) => {
    await page.route('**/listPublishedAnnouncements', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: []})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.locator('.nav-item[data-view="view-reward"]').click();

    await expect(page.locator('#view-reward')).toHaveClass(/active/);
    await expect(page.getByRole('heading', {name: '公佈欄'})).toBeVisible();
    await expect(page.getByRole('heading', {name: '敬請期待'})).toBeVisible();
    await expect(page.getByRole('img', {name: '小火花'})).toBeVisible();
});

test('訪客可以看許願池但不能留言', async ({page}) => {
    await page.route('**/listWishes', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: [{
                id: 'wish-1',
                message: '希望多一些交流活動',
                authorName: '匿名',
                anonymous: true,
                category: 'suggestion',
                createdAt: Date.now()
            }]})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.getByRole('button', {name: '許願池'}).click();

    await expect(page.locator('#view-wishes')).toHaveClass(/active/);
    await expect(page.locator('#wish-list')).toContainText('希望多一些交流活動');
    await expect(page.locator('#wish-form')).toBeHidden();
    await expect(page.locator('#wish-guest-note')).toBeVisible();
});

test('點擊排行榜頭像會顯示使用者資訊', async ({page}) => {
    await openApp(page);
    const visibleBio = '甲'.repeat(50);
    const hiddenBio = '這段內容不該顯示';
    const longBio = `${visibleBio}${hiddenBio}`;

    await page.evaluate(bio => {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.querySelector('#view-social').classList.add('active');
        window.renderLeaderboardUsers([{
            id: 'social-test-user',
            nickname: '測試小火花',
            dept: '教育心理與諮商學系三年級',
            bio,
            points: 18,
            totalPoints: 18
        }]);
    }, longBio);

    await page.getByRole('button', {name: '查看 測試小火花 的個人資訊'}).click();

    const detail = page.locator('#leaderboard-detail');
    await expect(detail).toHaveClass(/active/);
    await expect(detail).toContainText('測試小火花');
    await expect(detail).toContainText('教育心理與諮商學系三年級');
    await expect(detail.locator('.detail-info-block .detail-text')).toHaveText(`自我介紹：${visibleBio}`);
    await expect(detail).not.toContainText(hiddenBio);
});
