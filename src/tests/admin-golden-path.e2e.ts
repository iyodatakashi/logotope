/**
 * 管理者ゴールデンパス E2E テスト
 *
 * Firebase Auth と Functions API をネットワークレベルでモックし、
 * ログイン → テーマ作成 → 承認フロー → 公開 の全フローを検証する。
 *
 * 前提: `npm run build && npm run preview` でアプリが起動している
 * (playwright.config.ts の webServer 設定による)
 *
 * ※ 公開後の `/debate/[id]` での SSR 表示検証には Firebase Data Connect
 *   エミュレーター（ポート 9399）の起動が必要。
 */

import { test, expect, type Page } from '@playwright/test';

// 期限切れのない偽 JWT（Firebase Auth クライアント SDK がペイロードをパースできる形式）
function makeTestJwt(): string {
  const b64url = (s: string) =>
    Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'test', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: 'https://securetoken.google.com/demo-logotope',
      aud: 'demo-logotope',
      auth_time: 1700000000,
      user_id: 'e2e-test-uid',
      sub: 'e2e-test-uid',
      iat: 1700000000,
      exp: 9999999999,
      email: 'admin@example.com',
      email_verified: true,
      firebase: {
        identities: { email: ['admin@example.com'] },
        sign_in_provider: 'password',
      },
    })
  );
  return `${header}.${payload}.fakeSignature`;
}

const FAKE_JWT = makeTestJwt();

// モック API 状態管理
class MockApiState {
  topicStatus = 'pending';
  stakeholders = [
    { id: 'sm-1-0', role: '一般市民', stanceDirection: 'neutral', minorityLevel: 'low', rationale: '生活への影響に関心がある' },
    { id: 'sm-1-1', role: '企業経営者', stanceDirection: 'against', minorityLevel: 'medium', rationale: 'コスト増加を懸念する' },
    { id: 'sm-1-2', role: '環境団体', stanceDirection: 'pro', minorityLevel: 'high', rationale: '環境保護を優先する' },
  ];
  personas = [
    { id: 'p-1', topicId: 'e2e-topic-1', name: '田中太郎', stakeholderRole: '一般市民', age: 45, occupation: '会社員', background: '東京在住', interests: '家族の生活', stanceDirection: 'neutral', approved: false, sortOrder: 0 },
    { id: 'p-2', topicId: 'e2e-topic-1', name: '佐藤花子', stakeholderRole: '企業経営者', age: 52, occupation: '中小企業社長', background: '製造業', interests: '経営安定', stanceDirection: 'against', approved: false, sortOrder: 1 },
  ];
  interviews = [
    { personaId: 'p-1', personaName: '田中太郎', interviewRecord: '生活コストへの影響を心配している。', status: 'completed' },
    { personaId: 'p-2', personaName: '佐藤花子', interviewRecord: '経営への悪影響を懸念している。', status: 'completed' },
  ];
  debateTurns = [
    { id: 't-0', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '', content: 'では議論を始めましょう。', beliefChangesTriggered: [] },
    { id: 't-1', turnIndex: 1, speakerType: 'persona', speakerName: '田中太郎', speakerRole: '一般市民', content: '生活への影響を考えると慎重に議論すべきです。', beliefChangesTriggered: [] },
    { id: 't-2', turnIndex: 2, speakerType: 'persona', speakerName: '佐藤花子', speakerRole: '企業経営者', content: '経営への影響が大きく、反対せざるを得ません。', beliefChangesTriggered: [] },
  ];
  debateSessionId = 'e2e-debate-1';
}

async function setupMocks(page: Page, state: MockApiState) {
  // Firebase Auth: sign-in
  await page.route('**/accounts:signInWithPassword*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        idToken: FAKE_JWT,
        email: 'admin@example.com',
        refreshToken: 'fake-refresh-token',
        expiresIn: '3600',
        localId: 'e2e-test-uid',
        registered: true,
        kind: 'identitytoolkit#VerifyPasswordResponse',
      }),
    });
  });

  // Firebase Auth: token refresh
  await page.route('**/securetoken.googleapis.com/v1/token*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: FAKE_JWT,
        expires_in: '3600',
        token_type: 'Bearer',
        refresh_token: 'fake-refresh-token',
        id_token: FAKE_JWT,
      }),
    });
  });

  // Topics: list
  await page.route('**/api/topics', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ topicId: 'e2e-topic-1' }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'e2e-topic-1', title: 'AI規制について', status: state.topicStatus }]),
      });
    }
  });

  // Topic: get by id
  await page.route('**/api/topics/e2e-topic-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'e2e-topic-1', title: 'AI規制について', status: state.topicStatus }),
    });
  });

  // Stakeholders: generate
  await page.route('**/api/topics/e2e-topic-1/stakeholders/generate', async (route) => {
    state.topicStatus = 'surveying';
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'e2e-topic-1' }) });
  });

  // Stakeholders: list
  await page.route('**/api/topics/e2e-topic-1/stakeholders', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.stakeholders),
      });
    }
  });

  // Stakeholders: approve
  await page.route('**/api/topics/e2e-topic-1/stakeholders/approve', async (route) => {
    state.topicStatus = 'generating_personas';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });

  // Personas: list
  await page.route('**/api/topics/e2e-topic-1/personas', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.personas),
      });
    }
  });

  // Personas: generate (re-generate)
  await page.route('**/api/topics/e2e-topic-1/personas/generate', async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'e2e-topic-1' }) });
  });

  // Personas: approve
  await page.route('**/api/topics/e2e-topic-1/personas/approve', async (route) => {
    state.topicStatus = 'interviewing';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });

  // Interviews: list
  await page.route('**/api/topics/e2e-topic-1/interviews', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.interviews),
      });
    }
  });

  // Interviews: start
  await page.route('**/api/topics/e2e-topic-1/interviews/start', async (route) => {
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'e2e-topic-1' }) });
  });

  // Interviews: approve
  await page.route('**/api/topics/e2e-topic-1/interviews/approve', async (route) => {
    state.topicStatus = 'completed';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
  });

  // Debate: get (admin preview)
  await page.route('**/api/topics/e2e-topic-1/debate', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: state.debateSessionId, turns: state.debateTurns }),
      });
    }
  });

  // Debate: start
  await page.route('**/api/topics/e2e-topic-1/debate/start', async (route) => {
    state.topicStatus = 'completed';
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ debateSessionId: state.debateSessionId }),
    });
  });

  // Debate: publish
  await page.route(`**/api/debates/${state.debateSessionId}/publish`, async (route) => {
    state.topicStatus = 'published';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', url: `/debate/${state.debateSessionId}` }),
    });
  });

  // Firestore (progress listener) - ignore
  await page.route('**/firestore.googleapis.com/**', async (route) => {
    await route.abort();
  });
}

test.describe('管理者ゴールデンパス', () => {
  test('ログイン → テーマ作成 → ステークホルダー承認 → ペルソナ承認 → 取材承認 → 公開', async ({ page }) => {
    const state = new MockApiState();
    await setupMocks(page, state);

    // ---- Step 1: ログイン ----
    await page.goto('/admin/login');
    await page.getByLabel('メールアドレス').fill('admin@example.com');
    await page.getByLabel('パスワード').fill('password123');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await page.waitForURL('**/admin', { timeout: 5000 });

    // ---- Step 2: テーマ作成 ----
    await page.getByRole('button', { name: '新しいテーマを作成' }).click();
    await page.waitForURL('**/admin/topics/new');
    await page.getByRole('textbox').fill('AI規制について');
    await page.getByRole('button', { name: '作成する' }).click();
    await page.waitForURL('**/admin/debate/e2e-topic-1', { timeout: 5000 });
    await expect(page.getByText('AI規制について')).toBeVisible();

    // ---- Step 3: ステークホルダー調査開始・承認 ----
    await expect(page.getByRole('button', { name: 'ステークホルダー調査を開始' })).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'ステークホルダー調査を開始' }).click();

    // handleAction: POST generate → loadTopic (surveying) → loadPhaseData (stakeholders)
    await expect(page.getByText('ステークホルダーレビュー')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('一般市民')).toBeVisible();
    await page.getByRole('button', { name: '承認' }).click();

    // ---- Step 4: ペルソナ承認 ----
    // After stakeholders/approve: status=generating_personas → loadPhaseData loads stakeholders + personas
    await expect(page.getByText('ペルソナレビュー')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('田中太郎')).toBeVisible();
    await expect(page.getByText('佐藤花子')).toBeVisible();
    await page.getByRole('button', { name: '承認する' }).first().click();

    // ---- Step 5: 取材開始・承認 ----
    // After personas/approve: status=interviewing → loadPhaseData loads interviews
    await expect(page.getByText('取材を開始')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: '取材を開始' }).click();

    // After interviews/start: loadTopic returns interviewing, loadPhaseData loads interviews
    await expect(page.getByText('取材レコードレビュー')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('田中太郎')).toBeVisible();
    await page.getByRole('button', { name: '承認する' }).first().click();

    // ---- Step 6: 討論生成完了・公開 ----
    // After interviews/approve: status=completed → loadPhaseData loads debate
    await expect(page.getByText('討論プレビュー')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('では議論を始めましょう。')).toBeVisible();
    await page.getByRole('button', { name: '公開する' }).click();

    // ---- Step 7: 公開成功確認 ----
    await expect(page.getByText('公開しました')).toBeVisible({ timeout: 5000 });
    const publishLink = page.getByRole('link', { name: /\/debate\// });
    await expect(publishLink).toBeVisible();
    const href = await publishLink.getAttribute('href');
    expect(href).toBe('/debate/e2e-debate-1');
  });

  test('公開後の URL で討論ページが表示される（要 Firebase Data Connect エミュレーター）', async ({ page }) => {
    // NOTE: このテストは Firebase Data Connect エミュレーター（localhost:9399）が
    // 起動していない場合はスキップされる
    test.skip(
      !process.env.DATA_CONNECT_EMULATOR_HOST,
      'Firebase Data Connect エミュレーターが必要 (DATA_CONNECT_EMULATOR_HOST 未設定)'
    );

    await page.goto('/debate/e2e-debate-1');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('← 討論一覧')).toBeVisible();
  });
});
