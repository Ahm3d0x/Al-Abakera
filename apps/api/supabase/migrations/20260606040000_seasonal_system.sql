-- ============================================================
-- Mind Race — Phase 5.5 Seasons System Migration
-- ============================================================

-- 1. Alterations to existing tables
ALTER TABLE public.questions 
  ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES public.seasons(id) ON DELETE SET NULL;

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS claimed_season_rewards JSONB DEFAULT '[]'::jsonb;

-- 2. Create archive table for season rankings
CREATE TABLE IF NOT EXISTS public.season_rankings_archive (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id       UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,
  rank_tier       TEXT NOT NULL,
  rank_points     INTEGER NOT NULL,
  placement       INTEGER NOT NULL,
  rewards_awarded JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(season_id, user_id)
);

-- Enable RLS and add policy
ALTER TABLE public.season_rankings_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to rankings archive" ON public.season_rankings_archive;
CREATE POLICY "Allow public read access to rankings archive" ON public.season_rankings_archive
  FOR SELECT TO public USING (true);

-- 3. Register season-exclusive badges
INSERT INTO public.badges (key, name, description, category, requirement)
VALUES
  ('s1_titan', 'Season 1 Titan', 'Reached Titan rank in Season 1', 'seasonal', '{"type":"season_rank","rank":"Titan"}'),
  ('s1_legend', 'Season 1 Legend', 'Reached Legend rank in Season 1', 'seasonal', '{"type":"season_rank","rank":"Legend"}'),
  ('s1_competitor', 'Season 1 Competitor', 'Participated in Season 1', 'seasonal', '{"type":"season_play"}')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    requirement = EXCLUDED.requirement;

-- 4. Create first active season if none is active
INSERT INTO public.seasons (name, theme, description, start_date, end_date, is_active, rewards)
SELECT
  'Season 1: Electronic Genesis',
  'Electronics & Tech / الإلكترونيات والتقنية',
  'Dive deep into electronic circuits, semiconductors, logic gates, and computing history!',
  '2026-06-01 00:00:00+00',
  '2026-07-06 23:59:59+00',
  TRUE,
  '[
    {"rp": 1000, "coins": 500, "cosmetic": "circuit_voyager", "badge": "s1_competitor", "label": {"en": "Bronze Voyager", "ar": "المسافر البرونزي"}},
    {"rp": 3000, "coins": 1500, "cosmetic": "cyber_neon", "badge": "s1_competitor", "label": {"en": "Neon Explorer", "ar": "مستكشف النيون"}},
    {"rp": 5000, "coins": 3000, "cosmetic": "electrode", "badge": "s1_competitor", "label": {"en": "Master Spark", "ar": "شرارة الأستاذ"}},
    {"rp": 7000, "coins": 5000, "cosmetic": "cybernetic_glow", "badge": "s1_legend", "label": {"en": "Legendary Glow", "ar": "التوهج الأسطوري"}},
    {"rp": 9000, "coins": 10000, "cosmetic": "electron_halo", "badge": "s1_titan", "label": {"en": "Titan Sphere", "ar": "المجال العملاق"}}
  ]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.seasons WHERE is_active = TRUE);

-- 5. Stored Procedure to Conclude and Reset a Season
CREATE OR REPLACE FUNCTION conclude_and_reset_season(
  p_new_season_name TEXT,
  p_new_season_theme TEXT,
  p_new_season_description TEXT,
  p_new_season_start TIMESTAMPTZ,
  p_new_season_end TIMESTAMPTZ,
  p_new_season_rewards JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID AS $$
DECLARE
  v_active_season_id UUID;
  v_rec record;
  v_placement integer := 0;
  v_badge_key text;
  v_cosmetic_key text;
  v_coins_bonus integer;
  v_inventory jsonb;
  v_rewards_awarded jsonb;
BEGIN
  -- Find current active season
  SELECT id INTO v_active_season_id FROM public.seasons WHERE is_active = TRUE LIMIT 1;
  
  IF v_active_season_id IS NULL THEN
    RAISE EXCEPTION 'No active season found to conclude';
  END IF;

  -- 1. Deactivate current season
  UPDATE public.seasons
  SET is_active = FALSE,
      end_date = NOW(),
      updated_at = NOW()
  WHERE id = v_active_season_id;

  -- 2. Archive rankings and award rewards
  -- We rank profiles with rank_points > 0 descending
  FOR v_rec IN 
    SELECT id, username, rank, rank_points, inventory
    FROM public.profiles
    WHERE rank_points > 0
    ORDER BY rank_points DESC, id ASC
  LOOP
    v_placement := v_placement + 1;
    
    -- Determine rewards based on rank
    v_coins_bonus := 0;
    v_cosmetic_key := NULL;
    v_badge_key := NULL;
    
    IF v_rec.rank = 'Titan' THEN
      v_badge_key := 's1_titan';
      v_cosmetic_key := 'electron_halo';
      v_coins_bonus := 5000;
    ELSIF v_rec.rank = 'Mythic' OR v_rec.rank = 'Legend' THEN
      v_badge_key := 's1_legend';
      v_cosmetic_key := 'cybernetic_glow';
      v_coins_bonus := 3000;
    ELSIF v_rec.rank = 'Master' OR v_rec.rank = 'Grand Master' THEN
      v_badge_key := 's1_competitor';
      v_cosmetic_key := 'electrode';
      v_coins_bonus := 2000;
    ELSIF v_rec.rank = 'Platinum' OR v_rec.rank = 'Diamond' THEN
      v_badge_key := 's1_competitor';
      v_cosmetic_key := 'circuit_voyager';
      v_coins_bonus := 1000;
    ELSE
      v_badge_key := 's1_competitor';
      v_coins_bonus := 500;
    END IF;

    -- Award badge if any
    IF v_badge_key IS NOT NULL THEN
      PERFORM public.award_badge_if_not_earned(v_rec.id, v_badge_key);
    END IF;

    -- Update inventory with cosmetic if any
    v_inventory := v_rec.inventory;
    IF v_inventory IS NULL THEN
      v_inventory := '[]'::jsonb;
    END IF;

    IF v_cosmetic_key IS NOT NULL AND NOT (v_inventory ? v_cosmetic_key) THEN
      v_inventory := v_inventory || jsonb_build_array(v_cosmetic_key);
    END IF;

    -- Update profile
    UPDATE public.profiles
    SET coins = coins + v_coins_bonus,
        inventory = v_inventory,
        rank_points = 0 -- triggers sync_profile_rank to 'Bronze'
    WHERE id = v_rec.id;

    -- Record rewards details
    v_rewards_awarded := jsonb_build_object(
      'coins', v_coins_bonus,
      'badge', v_badge_key,
      'cosmetic', v_cosmetic_key
    );

    -- Insert into archive
    INSERT INTO public.season_rankings_archive (
      season_id, user_id, username, rank_tier, rank_points, placement, rewards_awarded
    ) VALUES (
      v_active_season_id,
      v_rec.id,
      v_rec.username,
      v_rec.rank,
      v_rec.rank_points,
      v_placement,
      v_rewards_awarded
    );
  END LOOP;

  -- For all other users (0 rank points), just soft reset their rank points to 0 (already 0, but trigger ensures sync)
  UPDATE public.profiles
  SET rank_points = 0
  WHERE rank_points IS NULL OR rank_points <= 0;

  -- 3. Create and activate new season
  INSERT INTO public.seasons (
    name, theme, description, start_date, end_date, is_active, rewards
  ) VALUES (
    p_new_season_name,
    p_new_season_theme,
    p_new_season_description,
    p_new_season_start,
    p_new_season_end,
    TRUE,
    p_new_season_rewards
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Seed Season 1 exclusive questions
DO $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT id INTO v_season_id FROM public.seasons WHERE name = 'Season 1: Electronic Genesis' LIMIT 1;
  
  IF v_season_id IS NOT NULL THEN
    -- Q1: John Bardeen, Walter Brattain, William Shockley
    INSERT INTO public.questions (type, category, body, options, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'MULTIPLE_CHOICE',
      'Electronics / إلكترونيات',
      '{"en": "Who invented the first working transistor at Bell Labs in 1947?", "ar": "من اخترع أول ترانزستور عملي في مختبرات بيل عام 1947؟"}',
      '[
        {"id": "a", "text": {"en": "John Bardeen, Walter Brattain, and William Shockley", "ar": "جون باردين، ووالتر براتين، ووليام شوكلي"}},
        {"id": "b", "text": {"en": "Nikola Tesla and Thomas Edison", "ar": "نيكولا تسلا وتوماس إديسون"}},
        {"id": "c", "text": {"en": "Albert Einstein and Max Planck", "ar": "ألبرت أينشتاين وماكس بلانك"}},
        {"id": "d", "text": {"en": "Alan Turing and John von Neumann", "ar": "آلان تورينج وجون فون نيومان"}}
      ]'::jsonb,
      '"a"'::jsonb,
      'Medium',
      '{"en": "Bardeen, Brattain, and Shockley were awarded the 1956 Nobel Prize in Physics for inventing the point-contact transistor.", "ar": "حصل باردين وبراتين وشوكلي على جائزة نوبل في الفيزياء عام 1956 لاختراعهم ترانزستور التلامس النقطي."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q2: LED diode true/false
    INSERT INTO public.questions (type, category, body, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'TRUE_FALSE',
      'Electronics / إلكترونيات',
      '{"en": "An LED (Light Emitting Diode) allows electrical current to flow freely in both directions.", "ar": "يسمح الدايود الباعث للضوء (LED) للتيار الكهربائي بالمرور بحرية في كلا الاتجاهين."}',
      '"false"'::jsonb,
      'Easy',
      '{"en": "Like all diodes, an LED is a semiconductor that primarily allows current to flow in one direction (forward-biased).", "ar": "مثل جميع الدايودات، فإن الـ LED عبارة عن شبه موصل يسمح بمرور التيار بشكل أساسي في اتجاه واحد فقط."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q3: Ohm's law calculation
    INSERT INTO public.questions (type, category, body, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'CALCULATION_QUESTION',
      'Electronics / إلكترونيات',
      '{"en": "What is the voltage (in Volts) across a 10 Ohm resistor when a current of 2 Amperes flows through it?", "ar": "ما هي قيمة الجهد الكهربائي (بالفولت) عبر مقاومة بقيمة 10 أوم عندما يمر بها تيار كهربائي شدته 2 أمبير؟"}',
      '"20"'::jsonb,
      'Easy',
      '{"en": "Using Ohm''s law: V = I * R. V = 2A * 10 Ohms = 20V.", "ar": "باستخدام قانون أوم: الجهد = التيار * المقاومة. الجهد = 2 * 10 = 20 فولت."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q4: XOR gate
    INSERT INTO public.questions (type, category, body, options, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'MULTIPLE_CHOICE',
      'Electronics / إلكترونيات',
      '{"en": "Which logic gate outputs a binary 1 only when its inputs are different (one is 1, the other is 0)?", "ar": "أي البوابات المنطقية التالية تعطي مخرجاً بقيمة 1 ثنائية فقط عندما تكون مدخلاتها مختلفة (أحدها 1 والآخر 0)؟"}',
      '[
        {"id": "a", "text": {"en": "AND gate", "ar": "بوابة AND"}},
        {"id": "b", "text": {"en": "OR gate", "ar": "بوابة OR"}},
        {"id": "c", "text": {"en": "XOR gate", "ar": "بوابة XOR"}},
        {"id": "d", "text": {"en": "NAND gate", "ar": "بوابة NAND"}}
      ]'::jsonb,
      '"c"'::jsonb,
      'Medium',
      '{"en": "The Exclusive-OR (XOR) gate performs modulo-2 addition. It outputs 1 only when inputs are mismatched.", "ar": "تقوم بوابة XOR (الجمع الحصري) بعملية جمع المودولو 2، حيث تعطي 1 فقط عند اختلاف قيم المدخلات."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q5: Matching logic symbols
    INSERT INTO public.questions (type, category, body, matching_pairs, difficulty, explanation, season_id)
    VALUES (
      'MATCHING_QUESTION',
      'Electronics / إلكترونيات',
      '{"en": "Match the logic gate type with its Boolean algebra symbol/operation.", "ar": "صل نوع البوابة المنطقية بالرمز أو العملية الجبرية البوليانية المناسبة لها."}',
      '[
        {"leftId": "and", "leftText": {"en": "AND", "ar": "AND"}, "rightId": "mul", "rightText": {"en": "A * B", "ar": "A * B"}},
        {"leftId": "or", "leftText": {"en": "OR", "ar": "OR"}, "rightId": "add", "rightText": {"en": "A + B", "ar": "A + B"}},
        {"leftId": "not", "leftText": {"en": "NOT", "ar": "NOT"}, "rightId": "inv", "rightText": {"en": "!A (or A'')", "ar": "!A (أو متمم A)"}}
      ]'::jsonb,
      'Medium',
      '{"en": "AND is logical multiplication, OR is logical addition, and NOT is logical negation.", "ar": "بوابة AND تمثل الضرب المنطقي، بوابة OR تمثل الجمع المنطقي، وبوابة NOT تمثل النفي المنطقي."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q6: Ordering computer components
    INSERT INTO public.questions (type, category, body, options, ordering_items, difficulty, explanation, season_id)
    VALUES (
      'ORDERING_QUESTION',
      'Technology / التقنية',
      '{"en": "Order these electrical computer components from earliest to latest historical invention.", "ar": "رتب المكونات الحاسوبية الكهربائية التالية تاريخياً من الأقدم اختراعاً إلى الأحدث."}',
      '[
        {"id": "vt", "text": {"en": "Vacuum Tube", "ar": "الأنبوب المفرغ"}},
        {"id": "tr", "text": {"en": "Transistor", "ar": "الترانزستور"}},
        {"id": "ic", "text": {"en": "Integrated Circuit", "ar": "الدارة المتكاملة"}},
        {"id": "mp", "text": {"en": "Microprocessor", "ar": "المعالج الدقيق"}}
      ]'::jsonb,
      '["vt", "tr", "ic", "mp"]'::jsonb,
      'Medium',
      '{"en": "Vacuum tubes (1904) -> Transistors (1947) -> Integrated Circuits (1958) -> Microprocessors (1971).", "ar": "الأنابيب المفرغة (1904) -> الترانزستورات (1947) -> الدارات المتكاملة (1958) -> المعالجات الدقيقة (1971)."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q7: Capacitor DC block true/false
    INSERT INTO public.questions (type, category, body, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'TRUE_FALSE',
      'Electronics / إلكترونيات',
      '{"en": "In a steady-state DC circuit, a capacitor behaves as an open circuit (blocks Direct Current).", "ar": "في دوائر التيار المستمر المستقرة، يتصرف المكثف كدارة مفتوحة (يمنع مرور التيار المستمر)."}',
      '"true"'::jsonb,
      'Medium',
      '{"en": "Once fully charged, a capacitor blocks DC current completely, while allowing AC current to pass.", "ar": "بمجرد شحنه بالكامل، يمنع المكثف مرور التيار المستمر تماماً، بينما يسمح بمرور التيار المتردد."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q8: Capacitor parallel equivalent calculation
    INSERT INTO public.questions (type, category, body, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'CALCULATION_QUESTION',
      'Electronics / إلكترونيات',
      '{"en": "What is the total equivalent capacitance (in microfarads) of two 10uF capacitors connected in parallel?", "ar": "ما هي السعة الإجمالية المكافئة (بالميكروفاراد) لمكثفين قيمة كل منهما 10 ميكروفاراد متصلين على التوازي؟"}',
      '"20"'::jsonb,
      'Medium',
      '{"en": "For capacitors in parallel, capacitance adds up: C_eq = C1 + C2 = 10uF + 10uF = 20uF.", "ar": "للمكثفات على التوازي، تجمع السعات مباشرة: السعة المكافئة = 10 + 10 = 20 ميكروفاراد."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q9: AC to DC rectifier
    INSERT INTO public.questions (type, category, body, options, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'MULTIPLE_CHOICE',
      'Electronics / إلكترونيات',
      '{"en": "What electrical circuit component is primarily used to convert AC (Alternating Current) to DC (Direct Current)?", "ar": "ما هو مكون الدائرة الكهربائية المستخدم بشكل أساسي لتحويل التيار المتردد (AC) إلى تيار مستمر (DC)؟"}',
      '[
        {"id": "a", "text": {"en": "Transformer", "ar": "المحول"}},
        {"id": "b", "text": {"en": "Rectifier (Diode Bridge)", "ar": "المقوم (جسر الدايود)"}},
        {"id": "c", "text": {"en": "Inductor", "ar": "الملف / المحث"}},
        {"id": "d", "text": {"en": "Amplifier", "ar": "المضخم"}}
      ]'::jsonb,
      '"b"'::jsonb,
      'Medium',
      '{"en": "A rectifier, often built using a bridge of diodes, converts alternating current to pulsating direct current.", "ar": "المقوم، والذي يبنى غالباً باستخدام جسر من الدايودات، يقوم بتحويل التيار المتردد إلى تيار مستمر نابض."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;

    -- Q10: Volatile RAM memory
    INSERT INTO public.questions (type, category, body, options, correct_answer, difficulty, explanation, season_id)
    VALUES (
      'MULTIPLE_CHOICE',
      'Programming / البرمجة',
      '{"en": "Which type of computer memory is volatile, meaning it loses its stored data as soon as power is turned off?", "ar": "أي أنواع الذاكرة التالية تعتبر متطايرة، مما يعني أنها تفقد بياناتها المخزنة بمجرد انقطاع التيار الكهربائي؟"}',
      '[
        {"id": "a", "text": {"en": "ROM (Read-Only Memory)", "ar": "ذاكرة القراءة فقط ROM"}},
        {"id": "b", "text": {"en": "Flash Memory", "ar": "ذاكرة الفلاش Flash"}},
        {"id": "c", "text": {"en": "RAM (Random Access Memory)", "ar": "ذاكرة الوصول العشوائي RAM"}},
        {"id": "d", "text": {"en": "SSD (Solid State Drive)", "ar": "محرك الأقراص الحالة الصلبة SSD"}}
      ]'::jsonb,
      '"c"'::jsonb,
      'Easy',
      '{"en": "RAM is temporary working storage for the CPU and requires electrical power to maintain its state.", "ar": "ذاكرة الـ RAM هي ذاكرة تخزين مؤقتة للعمليات وتتطلب تياراً كهربائياً للحفاظ على البيانات المخزنة فيها."}',
      v_season_id
    ) ON CONFLICT DO NOTHING;
  END IF;
END $$;
