-- Executar no SQL Editor do Supabase DEPOIS de 001-integrity.sql (idempotente; pode rodar mais de uma vez).
-- Problema: tarefas criadas por uma versão antiga do app (código = contagem + 1) depois da 001 deixam
-- projects.next_task_number ATRÁS dos códigos já usados; a reserva devolvia um código existente
-- e o índice único tasks_project_code_unique recusava ("Este registro já existe").
-- Correção: (1) ressincroniza o contador agora; (2) a reserva passa a partir sempre de
-- max(T-NNN existente) + 1, mesmo que o contador esteja atrasado.
BEGIN;

UPDATE public.projects p SET next_task_number = GREATEST(
  p.next_task_number,
  COALESCE((SELECT max(substring(t.code from '^T-([0-9]+)$')::bigint) + 1
            FROM public.tasks t WHERE t.project_id = p.id AND t.code ~ '^T-[0-9]+$'), 1)
);

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
      SELECT 1 FROM public.project_shares s
      WHERE s.project_id = p.id AND s.user_id = auth.uid() AND s.role IN ('admin', 'editor')
    ))
  ) THEN RAISE EXCEPTION 'Sem permissão para criar tarefas neste projeto'; END IF;

  -- O UPDATE bloqueia a linha do projeto até o fim da transação: cada chamada reserva uma faixa exclusiva.
  -- O piso (maior T-NNN já usado + 1) garante que nunca se devolve um código existente.
  UPDATE public.projects p SET next_task_number = GREATEST(
      p.next_task_number,
      COALESCE((SELECT max(substring(t.code from '^T-([0-9]+)$')::bigint) + 1
                FROM public.tasks t WHERE t.project_id = p.id AND t.code ~ '^T-[0-9]+$'), 1)
    ) + p_count
    WHERE p.id = p_project_id RETURNING p.next_task_number INTO last_number;
  FOR n IN (last_number - p_count)..(last_number - 1) LOOP
    result := array_append(result, 'T-' || repeat('0', greatest(0, 3 - length(n::text))) || n::text);
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.allocate_task_codes(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_task_codes(uuid, integer) TO authenticated;

COMMIT;
