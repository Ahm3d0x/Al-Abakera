-- Migration to add Question Packs, Junction Items, and Reviews

CREATE TABLE question_packs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL CHECK (category IN ('Science', 'Math', 'Electronics', 'Programming', 'Custom')),
  is_public       BOOLEAN DEFAULT false,
  creator_id      UUID REFERENCES profiles(id) ON DELETE CASCADE,
  rating_avg      NUMERIC(3,2) DEFAULT 0.00 CHECK (rating_avg >= 0 AND rating_avg <= 5),
  rating_count    INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table between question_packs and questions
CREATE TABLE question_pack_items (
  pack_id         UUID REFERENCES question_packs(id) ON DELETE CASCADE,
  question_id     UUID REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY (pack_id, question_id)
);

CREATE TABLE question_pack_reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_id         UUID REFERENCES question_packs(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES profiles(id) ON DELETE CASCADE,
  rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pack_id, user_id)
);

-- Trigger to automatically calculate rating_avg and rating_count for packs
CREATE OR REPLACE FUNCTION update_pack_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE question_packs
    SET 
      rating_avg = (SELECT COALESCE(ROUND(AVG(rating), 2), 0.00) FROM question_pack_reviews WHERE pack_id = NEW.pack_id),
      rating_count = (SELECT COUNT(*) FROM question_pack_reviews WHERE pack_id = NEW.pack_id)
    WHERE id = NEW.pack_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE question_packs
    SET 
      rating_avg = (SELECT COALESCE(ROUND(AVG(rating), 2), 0.00) FROM question_pack_reviews WHERE pack_id = OLD.pack_id),
      rating_count = (SELECT COUNT(*) FROM question_pack_reviews WHERE pack_id = OLD.pack_id)
    WHERE id = OLD.pack_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pack_rating
AFTER INSERT OR UPDATE OR DELETE ON question_pack_reviews
FOR EACH ROW EXECUTE FUNCTION update_pack_rating();

-- Enable RLS
ALTER TABLE question_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_pack_reviews ENABLE ROW LEVEL SECURITY;

-- question_packs RLS policies
CREATE POLICY select_public_packs ON question_packs FOR SELECT 
  USING (is_public = true OR creator_id = auth.uid());

CREATE POLICY insert_own_packs ON question_packs FOR INSERT 
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY update_own_packs ON question_packs FOR UPDATE 
  USING (creator_id = auth.uid()) 
  WITH CHECK (creator_id = auth.uid());

CREATE POLICY delete_own_packs ON question_packs FOR DELETE 
  USING (creator_id = auth.uid());

-- question_pack_items RLS policies
CREATE POLICY select_pack_items ON question_pack_items FOR SELECT 
  USING (EXISTS (SELECT 1 FROM question_packs WHERE id = pack_id AND (is_public = true OR creator_id = auth.uid())));

CREATE POLICY write_pack_items ON question_pack_items FOR ALL 
  USING (EXISTS (SELECT 1 FROM question_packs WHERE id = pack_id AND creator_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM question_packs WHERE id = pack_id AND creator_id = auth.uid()));

-- question_pack_reviews RLS policies
CREATE POLICY select_reviews ON question_pack_reviews FOR SELECT 
  USING (true);

CREATE POLICY insert_reviews ON question_pack_reviews FOR INSERT 
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM question_packs WHERE id = pack_id AND is_public = true));

CREATE POLICY update_own_reviews ON question_pack_reviews FOR UPDATE 
  USING (user_id = auth.uid()) 
  WITH CHECK (user_id = auth.uid());

CREATE POLICY delete_own_reviews ON question_pack_reviews FOR DELETE 
  USING (user_id = auth.uid());
