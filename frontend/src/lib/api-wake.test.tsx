import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiWakeNotice } from "@/features/notice/api-wake-notice";
import { requestApi } from "./api";
import { IDLE_SLEEP_MS, recordApiResponse, resetApiWakeForTest, SLOW_REQUEST_MS, wakeApi, watchApiRequest } from "./api-wake";

const wakeMessage = /サーバーを起動しています/;

beforeEach(() => {
  vi.useFakeTimers();
  resetApiWakeForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("起動待ちの案内", () => {
  it("応答を受け取っていないときの操作が遅いと、起動待ちと伝える", () => {
    render(<ApiWakeNotice />);
    const done = watchApiRequest();

    act(() => vi.advanceTimersByTime(SLOW_REQUEST_MS - 1));
    expect(screen.getByRole("status")).toHaveTextContent("");

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent(wakeMessage);

    act(() => done());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("どれか1つでも応答が届けば、ほかの操作を待っていても案内を消す", () => {
    render(<ApiWakeNotice />);
    watchApiRequest();
    act(() => vi.advanceTimersByTime(SLOW_REQUEST_MS));
    expect(screen.getByRole("status")).toHaveTextContent(wakeMessage);

    act(() => recordApiResponse(new Response(null, { status: 200 })));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("最近応答を受け取っていれば、遅いのは処理そのものとみなして伝えない", () => {
    render(<ApiWakeNotice />);
    recordApiResponse(new Response(null, { status: 200 }));
    watchApiRequest();

    // 生成はふだんでも20秒ほどかかる。
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("最後の応答から止まるまでの時間がたっていれば、また伝える", () => {
    render(<ApiWakeNotice />);
    recordApiResponse(new Response(null, { status: 200 }));
    act(() => vi.advanceTimersByTime(IDLE_SLEEP_MS));
    watchApiRequest();

    act(() => vi.advanceTimersByTime(SLOW_REQUEST_MS));
    expect(screen.getByRole("status")).toHaveTextContent(wakeMessage);
  });

  it("待っているあいだに別の応答が届いていれば、伝えない", () => {
    render(<ApiWakeNotice />);
    watchApiRequest();
    act(() => vi.advanceTimersByTime(SLOW_REQUEST_MS - 1000));
    recordApiResponse(new Response(null, { status: 200 }));

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("手前の基盤が返す502〜504は、起きた証拠にしない", () => {
    render(<ApiWakeNotice />);
    recordApiResponse(new Response(null, { status: 502 }));
    watchApiRequest();

    act(() => vi.advanceTimersByTime(SLOW_REQUEST_MS));
    expect(screen.getByRole("status")).toHaveTextContent(wakeMessage);
  });
});

describe("requestApi", () => {
  it("応答が遅いあいだだけ起動待ちと伝え、応答が届けば消す", async () => {
    let respond: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      respond = resolve;
    })));
    render(<ApiWakeNotice />);

    const request = requestApi("/generate", { method: "POST" });
    await act(() => vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS));
    expect(screen.getByRole("status")).toHaveTextContent(wakeMessage);

    await act(async () => {
      respond(new Response(null, { status: 200 }));
      await request;
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("wakeApi", () => {
  it("止まっているかもしれないときだけ、ヘルスチェックを1つ送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    wakeApi("/api/v1/health");
    // 返る前に呼ばれても重ねて送らない。
    wakeApi("/api/v1/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/health");

    // 応答を受け取ったあとは、止まるまでの時間がたつまで送らない。
    await vi.advanceTimersByTimeAsync(0);
    wakeApi("/api/v1/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(IDLE_SLEEP_MS);
    wakeApi("/api/v1/health");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("通信に失敗しても例外を出さず、次の機会にまた送る", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    expect(() => wakeApi("/api/v1/health")).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    wakeApi("/api/v1/health");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
