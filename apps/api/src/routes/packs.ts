import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { QuestionPack, QuestionPackReview } from '@mind-race/shared';

const router = Router();

// Helper to sanitize questions (remove answers if player, but allow creators to view)
function sanitizeQuestion(q: any, canViewAnswer: boolean) {
  if (!q) return q;
  if (!canViewAnswer) {
    const { correct_answer, correctAnswer, coding_test_cases, codingTestCases, ...rest } = q;
    return rest;
  }
  return q;
}

// 1. List question packs (Public packs and the user's private packs)
router.get('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { category } = req.query;
  const userId = req.profile?.id;

  try {
    let query = supabaseAdmin
      .from('question_packs')
      .select('*, profiles!question_packs_creator_id_fkey(username)');

    // filter: is_public = true OR creator_id = userId
    query = query.or(`is_public.eq.true,creator_id.eq.${userId}`);

    if (category) {
      query = query.eq('category', String(category));
    }

    const { data: packs, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const formattedPacks = (packs || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      isPublic: p.is_public,
      creatorId: p.creator_id,
      creatorUsername: p.profiles?.username || 'Creator',
      ratingAvg: Number(p.rating_avg || 0),
      ratingCount: Number(p.rating_count || 0),
      defaultLanguage: p.default_language,
      version: p.version,
      tags: p.tags,
      metadata: p.metadata,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

    return res.json(formattedPacks);
  } catch (err) {
    console.error('List packs error:', err);
    return res.status(500).json({ error: 'Internal server error listing packs' });
  }
});

// 2. Get details of a single pack (including associated questions and reviews)
router.get('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.profile?.id;

  try {
    // Fetch pack metadata
    const { data: pack, error: packErr } = await supabaseAdmin
      .from('question_packs')
      .select('*, profiles!question_packs_creator_id_fkey(username)')
      .eq('id', id)
      .maybeSingle();

    if (packErr || !pack) {
      return res.status(404).json({ error: 'Question pack not found' });
    }

    // Check authorization: must be public or creator
    if (!pack.is_public && pack.creator_id !== userId) {
      return res.status(403).json({ error: 'Access denied: Private question pack' });
    }

    // Fetch associated questions through junction table
    const { data: junctionItems, error: jErr } = await supabaseAdmin
      .from('question_pack_items')
      .select('question_id')
      .eq('pack_id', id);

    let questions: any[] = [];
    if (!jErr && junctionItems && junctionItems.length > 0) {
      const qIds = junctionItems.map((item: any) => item.question_id);
      const { data: qData } = await supabaseAdmin
        .from('questions')
        .select('*')
        .in('id', qIds);
      questions = qData || [];
    }

    // Fetch reviews
    const { data: reviewsData, error: rErr } = await supabaseAdmin
      .from('question_pack_reviews')
      .select('*, profiles(username)')
      .eq('pack_id', id)
      .order('created_at', { ascending: false });

    const formattedReviews = (reviewsData || []).map((r: any) => ({
      id: r.id,
      packId: r.pack_id,
      userId: r.user_id,
      username: r.profiles?.username || 'Reviewer',
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
    }));

    // Can only view answer keys if the user is the creator or has admin/staff privileges
    const canViewAnswers = pack.creator_id === userId || !!(req.profile?.isAdmin || req.profile?.isTeacher);
    const sanitizedQuestions = questions.map(q => sanitizeQuestion(q, canViewAnswers));

    return res.json({
      pack: {
        id: pack.id,
        title: pack.title,
        description: pack.description,
        category: pack.category,
        isPublic: pack.is_public,
        creatorId: pack.creator_id,
        creatorUsername: pack.profiles?.username || 'Creator',
        ratingAvg: Number(pack.rating_avg || 0),
        ratingCount: Number(pack.rating_count || 0),
        defaultLanguage: pack.default_language,
        version: pack.version,
        tags: pack.tags,
        metadata: pack.metadata,
        createdAt: pack.created_at,
        updatedAt: pack.updated_at,
      },
      questions: sanitizedQuestions,
      reviews: formattedReviews
    });
  } catch (err) {
    console.error('Get pack details error:', err);
    return res.status(500).json({ error: 'Internal server error fetching pack details' });
  }
});

// 3. Create a new question pack
router.post('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { title, description, category, isPublic, questions, defaultLanguage, version, tags } = req.body;
  const userId = req.profile?.id;

  if (!title || !category) {
    return res.status(400).json({ error: 'Title and category are required' });
  }

  try {
    // Gate public packs behind Creator Tokens
    if (isPublic) {
      const tokensCount = req.profile?.creatorTokens || 0;
      if (tokensCount < 5) {
        return res.status(400).json({ error: 'Insufficient Creator Tokens. Publishing a public question pack costs 5 Creator Tokens.' });
      }
      
      // Deduct tokens
      const { error: tokenErr } = await supabaseAdmin
        .from('profiles')
        .update({ creator_tokens: tokensCount - 5 })
        .eq('id', userId);

      if (tokenErr) {
        return res.status(500).json({ error: 'Failed to process Creator Tokens payment: ' + tokenErr.message });
      }
    }

    // 1. Insert pack metadata
    const { data: pack, error: packErr } = await supabaseAdmin
      .from('question_packs')
      .insert({
        title,
        description,
        category,
        is_public: !!isPublic,
        creator_id: userId,
        default_language: defaultLanguage || 'en',
        version: version || 1,
        tags: tags || []
      })
      .select()
      .single();

    if (packErr || !pack) {
      return res.status(500).json({ error: 'Failed to create question pack metadata: ' + packErr?.message });
    }

    // 2. Create and associate questions if provided
    if (questions && Array.isArray(questions) && questions.length > 0) {
      for (const q of questions) {
        // Insert question
        const { data: insertedQ, error: qErr } = await supabaseAdmin
          .from('questions')
          .insert({
            type: q.type,
            category: category, // Inherit category from pack
            body: q.body,
            image_url: q.imageUrl || q.image_url,
            options: q.options,
            correct_answer: q.correctAnswer || q.correct_answer,
            ordering_items: q.orderingItems || q.ordering_items,
            matching_pairs: q.matchingPairs || q.matching_pairs,
            coding_test_cases: q.codingTestCases || q.coding_test_cases,
            difficulty: q.difficulty || 'Medium',
            explanation: q.explanation,
            created_by: userId
          })
          .select()
          .single();

        if (!qErr && insertedQ) {
          // Link question to pack
          await supabaseAdmin
            .from('question_pack_items')
            .insert({
              pack_id: pack.id,
              question_id: insertedQ.id
            });
        }
      }
    }

    return res.status(201).json(pack);
  } catch (err) {
    console.error('Create pack error:', err);
    return res.status(500).json({ error: 'Internal server error creating question pack' });
  }
});

// 4. Update an existing question pack details
router.put('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { title, description, category, isPublic, defaultLanguage, version, tags } = req.body;
  const userId = req.profile?.id;

  try {
    const { data: pack, error: fetchErr } = await supabaseAdmin
      .from('question_packs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !pack) {
      return res.status(404).json({ error: 'Question pack not found' });
    }

    if (pack.creator_id !== userId) {
      return res.status(403).json({ error: 'Access denied: Only the pack creator can edit details' });
    }

    // Gate transitioning private pack to public behind tokens
    if (isPublic && !pack.is_public) {
      const tokensCount = req.profile?.creatorTokens || 0;
      if (tokensCount < 5) {
        return res.status(400).json({ error: 'Insufficient Creator Tokens. Publishing a public question pack costs 5 Creator Tokens.' });
      }

      // Deduct tokens
      const { error: tokenErr } = await supabaseAdmin
        .from('profiles')
        .update({ creator_tokens: tokensCount - 5 })
        .eq('id', userId);

      if (tokenErr) {
        return res.status(500).json({ error: 'Failed to process Creator Tokens payment: ' + tokenErr.message });
      }
    }

    const { data: updatedPack, error: updateErr } = await supabaseAdmin
      .from('question_packs')
      .update({
        title: title !== undefined ? title : pack.title,
        description: description !== undefined ? description : pack.description,
        category: category !== undefined ? category : pack.category,
        is_public: isPublic !== undefined ? !!isPublic : pack.is_public,
        default_language: defaultLanguage !== undefined ? defaultLanguage : pack.default_language,
        version: version !== undefined ? version : pack.version,
        tags: tags !== undefined ? tags : pack.tags,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    return res.json(updatedPack);
  } catch (err) {
    console.error('Update pack error:', err);
    return res.status(500).json({ error: 'Internal server error updating question pack' });
  }
});

// 5. Delete a question pack
router.delete('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.profile?.id;

  try {
    const { data: pack, error: fetchErr } = await supabaseAdmin
      .from('question_packs')
      .select('creator_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !pack) {
      return res.status(404).json({ error: 'Question pack not found' });
    }

    if (pack.creator_id !== userId) {
      return res.status(403).json({ error: 'Access denied: Only the pack creator can delete it' });
    }

    const { error: deleteErr } = await supabaseAdmin
      .from('question_packs')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      return res.status(500).json({ error: deleteErr.message });
    }

    return res.json({ status: 'success', message: 'Question pack deleted successfully' });
  } catch (err) {
    console.error('Delete pack error:', err);
    return res.status(500).json({ error: 'Internal server error deleting question pack' });
  }
});

// 6. Review and rate a public question pack
router.post('/:id/reviews', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { rating, comment } = req.body;
  const userId = req.profile?.id;

  const ratingInt = parseInt(rating);
  if (isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  try {
    // Fetch pack details
    const { data: pack, error: packErr } = await supabaseAdmin
      .from('question_packs')
      .select('creator_id, is_public')
      .eq('id', id)
      .maybeSingle();

    if (packErr || !pack) {
      return res.status(404).json({ error: 'Question pack not found' });
    }

    if (!pack.is_public) {
      return res.status(400).json({ error: 'Cannot rate or review private question packs' });
    }

    if (pack.creator_id === userId) {
      return res.status(400).json({ error: 'You cannot rate or review your own question pack' });
    }

    // Upsert review (a user has only one review/rating per pack)
    const { data: review, error: reviewErr } = await supabaseAdmin
      .from('question_pack_reviews')
      .upsert({
        pack_id: id,
        user_id: userId,
        rating: ratingInt,
        comment: comment || null,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'pack_id,user_id'
      })
      .select()
      .single();

    if (reviewErr) {
      return res.status(500).json({ error: reviewErr.message });
    }

    return res.json(review);
  } catch (err) {
    console.error('Review pack error:', err);
    return res.status(500).json({ error: 'Internal server error review/rating question pack' });
  }
});

export default router;
