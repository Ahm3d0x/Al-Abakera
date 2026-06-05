-- Migration to add metadata, tags, default language and versioning to question_packs

-- 1. Add default_language column
ALTER TABLE public.question_packs
ADD COLUMN default_language TEXT DEFAULT 'en'
CHECK (default_language IN ('ar', 'en'));

-- 2. Add version column
ALTER TABLE public.question_packs
ADD COLUMN version INTEGER DEFAULT 1;

-- 3. Add tags column
ALTER TABLE public.question_packs
ADD COLUMN tags TEXT[] DEFAULT '{}';

-- 4. Add metadata column
ALTER TABLE public.question_packs
ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

-- 5. Trigger to automatically maintain difficulty distribution and count in metadata
CREATE OR REPLACE FUNCTION update_pack_metadata()
RETURNS TRIGGER AS $$
DECLARE
  v_pack_id UUID;
  v_count INTEGER;
  v_easy INTEGER;
  v_medium INTEGER;
  v_hard INTEGER;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_pack_id := NEW.pack_id;
  ELSE
    v_pack_id := OLD.pack_id;
  END IF;

  -- Calculate counts
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE q.difficulty = 'Easy'),
         COUNT(*) FILTER (WHERE q.difficulty = 'Medium'),
         COUNT(*) FILTER (WHERE q.difficulty = 'Hard')
  INTO v_count, v_easy, v_medium, v_hard
  FROM public.question_pack_items qpi
  JOIN public.questions q ON q.id = qpi.question_id
  WHERE qpi.pack_id = v_pack_id;

  -- Update question_packs metadata (merging with existing if any, or creating new)
  UPDATE public.question_packs
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'question_count', v_count,
    'easy', v_easy,
    'medium', v_medium,
    'hard', v_hard
  )
  WHERE id = v_pack_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pack_metadata
AFTER INSERT OR UPDATE OR DELETE ON public.question_pack_items
FOR EACH ROW EXECUTE FUNCTION update_pack_metadata();

-- 6. Trigger to maintain metadata when difficulty of an individual question changes
CREATE OR REPLACE FUNCTION update_pack_metadata_on_question_change()
RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
BEGIN
  IF OLD.difficulty IS DISTINCT FROM NEW.difficulty THEN
    FOR r IN (SELECT pack_id FROM public.question_pack_items WHERE question_id = NEW.id) LOOP
      UPDATE public.question_packs
      SET metadata = COALESCE(metadata, '{}'::jsonb) || (
        SELECT jsonb_build_object(
          'question_count', COUNT(*),
          'easy', COUNT(*) FILTER (WHERE q.difficulty = 'Easy'),
          'medium', COUNT(*) FILTER (WHERE q.difficulty = 'Medium'),
          'hard', COUNT(*) FILTER (WHERE q.difficulty = 'Hard')
        )
        FROM public.question_pack_items qpi
        JOIN public.questions q ON q.id = qpi.question_id
        WHERE qpi.pack_id = r.pack_id
      )
      WHERE id = r.pack_id;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pack_metadata_on_question_change
AFTER UPDATE ON public.questions
FOR EACH ROW EXECUTE FUNCTION update_pack_metadata_on_question_change();

-- 7. Populate metadata for existing packs
DO $$
DECLARE
  r RECORD;
  v_count INTEGER;
  v_easy INTEGER;
  v_medium INTEGER;
  v_hard INTEGER;
BEGIN
  FOR r IN (SELECT id FROM public.question_packs) LOOP
    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE q.difficulty = 'Easy'),
           COUNT(*) FILTER (WHERE q.difficulty = 'Medium'),
           COUNT(*) FILTER (WHERE q.difficulty = 'Hard')
    INTO v_count, v_easy, v_medium, v_hard
    FROM public.question_pack_items qpi
    JOIN public.questions q ON q.id = qpi.question_id
    WHERE qpi.pack_id = r.id;

    UPDATE public.question_packs
    SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'question_count', v_count,
      'easy', v_easy,
      'medium', v_medium,
      'hard', v_hard
    )
    WHERE id = r.id;
  END LOOP;
END;
$$;
