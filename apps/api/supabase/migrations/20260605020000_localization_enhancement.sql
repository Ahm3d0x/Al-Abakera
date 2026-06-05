-- Migration to support multilingual question body, explanation, and pack title/description
-- Also adds import tracking batch column and index

-- 1. Add import tracking to questions
ALTER TABLE public.questions 
  ADD COLUMN import_batch TEXT NULL;

CREATE INDEX idx_questions_import_batch 
  ON public.questions(import_batch);

-- 2. Convert questions.body from TEXT to JSONB
-- Convert existing data to {"en": body, "ar": body}
ALTER TABLE public.questions 
  ALTER COLUMN body TYPE JSONB USING jsonb_build_object('en', body, 'ar', body);

-- 3. Convert questions.explanation from TEXT to JSONB
-- Convert existing data safely handling NULLs
ALTER TABLE public.questions 
  ALTER COLUMN explanation TYPE JSONB USING (
    CASE 
      WHEN explanation IS NULL THEN NULL 
      ELSE jsonb_build_object('en', explanation, 'ar', explanation) 
    END
  );

-- 4. Convert question_packs.title from TEXT to JSONB
-- Convert existing data to {"en": title, "ar": title}
ALTER TABLE public.question_packs 
  ALTER COLUMN title TYPE JSONB USING jsonb_build_object('en', title, 'ar', title);

-- 5. Convert question_packs.description from TEXT to JSONB
-- Convert existing data safely handling NULLs
ALTER TABLE public.question_packs 
  ALTER COLUMN description TYPE JSONB USING (
    CASE 
      WHEN description IS NULL THEN NULL 
      ELSE jsonb_build_object('en', description, 'ar', description) 
    END
  );
