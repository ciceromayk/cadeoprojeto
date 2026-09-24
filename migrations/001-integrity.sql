-- Executar no SQL Editor do Supabase antes de publicar a versão 4.7.0.
-- Pré-requisito: esquema do aplicativo existente (projects, tasks, project_shares).
-- Consulta prévia para códigos duplicados; resolva qualquer resultado antes de executar:
-- SELECT project_id, code, count(*) FROM public.tasks GROUP BY project_id, code HAVING count(*) > 1;
BEGIN;

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS next_task_number bigint;
UPDATE public.projects p SET next_task_number = GREATEST(
  COALESCE(p.next_task_number, 1),
  COALESCE((SELECT max(substring(t.code from '^T-([0-9]+)$')::bigint) + 1
            FROM public.tasks t WHERE t.project_id = p.id AND t.code ~ '^T-[0-9]+$'), 1)
);
ALTER TABLE public.projects ALTER COLUMN next_task_number SET DEFAULT 1;
ALTER TABLE public.projects ALTER COLUMN next_task_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_code_unique ON public.tasks(project_id, code);

CREATE OR REPLACE FUNCTION public.allocate_task_codes(p_project_id uuid, p_count integer)
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  last_number bigint;
  n bigint;
  result text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL OR p_count < 1 OR p_count > 500 THEN
    RAISE EXCEPTION 'Quantidade inválida ou sessão ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND
    (p.owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_shares s WHERE s.project_id = p.id
      AND s.user_id = auth.uid() AND s.role IN ('admin', 'editor')
    ))
  ) THEN RAISE EXCEPTION 'Sem permissão para criar tarefas neste projeto'; END IF;

  -- UPDATE bloqueia a linha até o fim da transação: cada chamada reserva uma faixa exclusiva.
  UPDATE public.projects SET next_task_number = next_task_number + p_count
    WHERE id = p_project_id RETURNING next_task_number INTO last_number;
  FOR n IN (last_number - p_count)..(last_number - 1) LOOP
    result := array_append(result, 'T-' || repeat('0', greatest(0, 3 - length(n::text))) || n::text);
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_task_codes(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_task_codes(uuid, integer) TO authenticated;

CREATE TABLE IF NOT EXISTS public.project_baselines (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  set_at timestamptz NOT NULL,
  tasks jsonb NOT NULL CHECK (jsonb_typeof(tasks) = 'object'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (project_id, slot)
);
ALTER TABLE public.project_baselines ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_baselines TO authenticated;

CREATE POLICY project_baselines_read ON public.project_baselines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
    AND (p.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.project_shares s
      WHERE s.project_id = p.id AND s.user_id = auth.uid()))));
CREATE POLICY project_baselines_insert ON public.project_baselines FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND (p.owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_shares s WHERE s.project_id = p.id
      AND s.user_id = auth.uid() AND s.role = 'admin'))));
CREATE POLICY project_baselines_update ON public.project_baselines FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
    AND (p.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.project_shares s
      WHERE s.project_id = p.id AND s.user_id = auth.uid() AND s.role = 'admin'))))
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p
    WHERE p.id = project_id AND (p.owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_shares s WHERE s.project_id = p.id
      AND s.user_id = auth.uid() AND s.role = 'admin'))));
CREATE POLICY project_baselines_delete ON public.project_baselines FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
    AND (p.owner_id = auth.uid() OR EXISTS (SELECT 1 FROM public.project_shares s
      WHERE s.project_id = p.id AND s.user_id = auth.uid() AND s.role = 'admin'))));
COMMIT;
