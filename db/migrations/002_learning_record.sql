-- 学習メモ（変更コードを含む）とAI利用記録を、作品と同じ行に保存する。
-- 作品と別々に保存すると、片方だけ古いまま残ってずれるため。
-- 既存の行は空の記録として読み込めるよう、既定値を置く。
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS learning_record JSONB NOT NULL
    DEFAULT '{"notes":[],"aiUsage":[]}'::JSONB;
