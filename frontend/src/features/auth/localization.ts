import { jaJP } from "@clerk/localizations";

/**
 * Clerkの日本語辞書で訳が入っていないエラー文言を補う。
 *
 * 訳が無いと、Clerkはサーバーが返す英語のエラー文をそのまま出す。
 * ログイン・新規登録・アカウント管理で出うるものを日本語にする。
 * 組織機能（organization_*）はこのアプリで使っていないため対象外。
 */
const missingErrors = {
  captcha_invalid: "ロボットでないことの確認に失敗しました。ページを再読み込みして、もう一度お試しください。",
  form_code_incorrect: "確認コードが正しくありません。届いたコードを確かめて、もう一度入力してください。",
  form_identifier_exists__email_address: "このメールアドレスはすでに登録されています。ログインしてください。",
  form_identifier_exists__phone_number: "この電話番号はすでに登録されています。ログインしてください。",
  form_identifier_exists__username: "このユーザー名はすでに使われています。別のユーザー名にしてください。",
  form_identifier_not_found: "このアカウントは見つかりません。入力内容を確かめるか、新規登録してください。",
  form_new_password_matches_current: "新しいパスワードが、いまのパスワードと同じです。別のパスワードにしてください。",
  form_param_format_invalid: "入力の形式が正しくありません。",
  form_param_format_invalid__email_address: "メールアドレスの形式が正しくありません。",
  form_param_format_invalid__phone_number: "電話番号の形式が正しくありません。",
  form_param_max_length_exceeded__first_name: "名が長すぎます。短くしてください。",
  form_param_max_length_exceeded__last_name: "姓が長すぎます。短くしてください。",
  form_param_max_length_exceeded__name: "名前が長すぎます。短くしてください。",
  form_param_nil: "この項目を入力してください。",
  form_param_type_invalid: "入力の内容が正しくありません。",
  form_param_type_invalid__email_address: "メールアドレスの内容が正しくありません。",
  form_param_type_invalid__phone_number: "電話番号の内容が正しくありません。",
  form_param_value_invalid: "入力の内容が正しくありません。",
  form_password_incorrect: "パスワードが正しくありません。もう一度入力してください。",
  form_password_size_in_bytes_exceeded: "パスワードが長すぎます。短くしてください。",
  form_password_untrusted__sign_in: "このパスワードは流出した可能性があるため使えません。別の方法でログインしてください。",
  form_password_validation_failed: "パスワードが正しくありません。もう一度入力してください。",
  form_username_invalid_character: "ユーザー名に使えない文字が含まれています。英数字などに直してください。",
  identification_deletion_failed: "最後に残ったログイン方法は削除できません。",
  not_allowed_access: "このアカウントではログインできません。",
  phone_number_exists: "この電話番号はすでに使われています。別の電話番号にしてください。",
  session_exists: "すでにログインしています。",
} satisfies Partial<NonNullable<(typeof jaJP)["unstable__errors"]>>;

export const clerkLocalization: typeof jaJP = {
  ...jaJP,
  unstable__errors: {
    ...jaJP.unstable__errors,
    ...missingErrors,
  },
};
