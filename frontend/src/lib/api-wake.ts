import { useSyncExternalStore } from "react";

/**
 * APIが止まっていて、起動を待っているかどうかを追う(#147)。
 *
 * 本番のAPI（Renderの無料プラン）は、しばらくアクセスが無いと止まり、
 * 次の最初のリクエストに40秒以上かかる。そのあいだ画面が「生成中…」のままだと、
 * 止まったのか待てば済むのかが利用者に分からない。
 *
 * ただし生成はふだんでも20秒ほどかかることがあるため、遅いだけでは起動待ちと決めつけない。
 * 応答をしばらく受け取っていない（止まっているかもしれない）ときに始めた操作が、
 * 応答の無いまま一定時間を超えたときだけ、起動待ちとみなす。
 */

// 操作を始めてから、起動待ちと伝えるまでの時間。
export const SLOW_REQUEST_MS = 5000;
// Renderの無料プランは、15分アクセスが無いと止まる。
export const IDLE_SLEEP_MS = 15 * 60 * 1000;

// APIから最後に応答を受け取った時刻。一度も受け取っていなければnull。
let lastResponseAt: number | null = null;
// 起動待ちとみなしている操作。応答を1つでも受け取れば、起きたと分かるので空にする。
const waitingRequests = new Set<symbol>();
const listeners = new Set<() => void>();
// 起こすための問い合わせが返るまでは、重ねて送らない。
let wakeInFlight = false;

function notify() {
  for (const listener of listeners) listener();
}

function mayBeAsleep(now: number): boolean {
  return lastResponseAt === null || now - lastResponseAt >= IDLE_SLEEP_MS;
}

/**
 * APIが応答を返したことを記録する。
 *
 * 手前の基盤が返す502〜504は、API自体が応答していないことがあるため、起きた証拠にしない。
 */
export function recordApiResponse(response: Response) {
  if (response.status >= 502 && response.status <= 504) return;
  lastResponseAt = Date.now();
  if (waitingRequests.size > 0) {
    waitingRequests.clear();
    notify();
  }
}

/**
 * 利用者の操作によるリクエストを見張る。終わったら、返した関数を呼ぶ。
 */
export function watchApiRequest(): () => void {
  const startedAt = Date.now();
  if (!mayBeAsleep(startedAt)) return () => {};

  const id = Symbol("api-request");
  const timer = setTimeout(() => {
    // 待っているあいだに別の応答が届いていれば、APIは起きている。遅いのは処理そのもの。
    if (lastResponseAt !== null && lastResponseAt >= startedAt) return;
    waitingRequests.add(id);
    notify();
  }, SLOW_REQUEST_MS);

  return () => {
    clearTimeout(timer);
    if (waitingRequests.delete(id)) notify();
  };
}

/**
 * 止まっているかもしれなければ、ヘルスチェックを送ってAPIを起こしておく。
 *
 * 利用者が操作する前に起動を始めておけば、最初の操作で待つ時間が短くなる。
 * 結果は画面に出さない。失敗しても、操作のときにあらためて伝える。
 */
export function wakeApi(healthUrl: string) {
  if (wakeInFlight || !mayBeAsleep(Date.now())) return;
  wakeInFlight = true;
  fetch(healthUrl)
    .then(recordApiResponse, () => {})
    .finally(() => {
      wakeInFlight = false;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isWaking() {
  return waitingRequests.size > 0;
}

export function useApiWaking(): boolean {
  return useSyncExternalStore(subscribe, isWaking);
}

// テスト用。モジュールの状態は読み込み1回につき1つのため、テストごとに初期状態へ戻す。
export function resetApiWakeForTest() {
  lastResponseAt = null;
  waitingRequests.clear();
  wakeInFlight = false;
}
