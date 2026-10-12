// 入力欄の下に出すエラー。欄とはaria-describedbyで結び、読み上げでも欄に移ったときに伝わるようにする。
// 入力のたびに読み上げると打ちにくいため、ライブ領域にはしない。
export function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return <p id={id} className="mt-1 text-[11px] leading-4 font-normal text-danger">{message}</p>;
}
