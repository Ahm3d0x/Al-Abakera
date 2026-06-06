import { Router, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { TournamentFormat, TournamentRound, TournamentMatchup } from '@mind-race/shared';
import { io } from '../index';

const router = Router();

// ============================================================================
// Programmatic Bracket Generators
// ============================================================================

// 1. Single Elimination (Knockout)
function generateKnockoutBracket(participants: any[], size: number): TournamentRound[] {
  const players = [...participants];
  while (players.length < size) {
    players.push({ id: 'BYE', username: 'BYE' });
  }

  const roundsCount = Math.log2(size);
  const rounds: TournamentRound[] = [];

  // Round 1
  const round1Matchups: TournamentMatchup[] = [];
  const matchesInRound1 = size / 2;
  for (let i = 0; i < matchesInRound1; i++) {
    const p1 = players[2 * i];
    const p2 = players[2 * i + 1];

    const isBye = p1.id === 'BYE' || p2.id === 'BYE';
    const winner = isBye ? (p1.id === 'BYE' ? p2.id : p1.id) : null;

    round1Matchups.push({
      id: `r1m${i + 1}`,
      p1: p1.id,
      p2: p2.id,
      p1Username: p1.username,
      p2Username: p2.username,
      winner,
      matchId: null,
      status: isBye ? 'COMPLETED' : 'READY',
      roundNumber: 1
    });
  }
  rounds.push({
    roundNumber: 1,
    name: 'Round 1',
    matchups: round1Matchups
  });

  // Subsequent rounds
  for (let r = 2; r <= roundsCount; r++) {
    const matchesInRound = size / Math.pow(2, r);
    const roundMatchups: TournamentMatchup[] = [];
    const roundName = r === roundsCount ? 'Finals' : r === roundsCount - 1 ? 'Semifinals' : r === roundsCount - 2 ? 'Quarterfinals' : `Round ${r}`;

    for (let i = 0; i < matchesInRound; i++) {
      roundMatchups.push({
        id: `r${r}m${i + 1}`,
        p1: null,
        p2: null,
        winner: null,
        matchId: null,
        status: 'WAITING',
        sourceMatchups: [`r${r - 1}m${2 * i + 1}`, `r${r - 1}m${2 * i + 2}`],
        roundNumber: r
      });
    }

    rounds.push({
      roundNumber: r,
      name: roundName,
      matchups: roundMatchups
    });
  }

  // Pre-propagate BYEs
  propagateBYEs(rounds, participants);

  return rounds;
}

// Helper to propagate BYEs recursively at generation time
function propagateBYEs(rounds: TournamentRound[], participants: any[]) {
  const usernames: { [id: string]: string } = { BYE: 'BYE' };
  for (const p of participants) {
    usernames[p.id || p.user_id] = p.username || p.profiles?.username || 'Player';
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const round of rounds) {
      for (const matchup of round.matchups) {
        if (matchup.status === 'COMPLETED') {
          if (matchup.winner) {
            const nextMatchup = findNextMatchupWithSource(rounds, matchup.id);
            if (nextMatchup) {
              const sourceIdx = nextMatchup.sourceMatchups?.indexOf(matchup.id);
              if (sourceIdx === 0 && nextMatchup.p1 !== matchup.winner) {
                nextMatchup.p1 = matchup.winner;
                nextMatchup.p1Username = usernames[matchup.winner];
                changed = true;
              } else if (sourceIdx === 1 && nextMatchup.p2 !== matchup.winner) {
                nextMatchup.p2 = matchup.winner;
                nextMatchup.p2Username = usernames[matchup.winner];
                changed = true;
              }

              if (nextMatchup.p1 && nextMatchup.p2 && nextMatchup.status === 'WAITING') {
                const isNextBye = nextMatchup.p1 === 'BYE' || nextMatchup.p2 === 'BYE';
                if (isNextBye) {
                  nextMatchup.winner = nextMatchup.p1 === 'BYE' ? nextMatchup.p2 : nextMatchup.p1;
                  nextMatchup.status = 'COMPLETED';
                } else {
                  nextMatchup.status = 'READY';
                }
                changed = true;
              }
            }
          }
        }
      }
    }
  }
}

function findNextMatchupWithSource(rounds: TournamentRound[], sourceId: string): TournamentMatchup | null {
  for (const round of rounds) {
    for (const matchup of round.matchups) {
      if (matchup.sourceMatchups?.includes(sourceId)) {
        return matchup;
      }
    }
  }
  return null;
}

// 2. Double Elimination
function generateDoubleEliminationBracket(participants: any[], size: number): TournamentRound[] {
  const players = [...participants];
  while (players.length < size) {
    players.push({ id: 'BYE', username: 'BYE' });
  }

  const rounds: TournamentRound[] = [];
  const usernames: { [id: string]: string } = { BYE: 'BYE' };
  for (const p of participants) {
    usernames[p.id || p.user_id] = p.username || 'Player';
  }

  // Round 1: Winners Round 1 (W1)
  const w1Matchups: TournamentMatchup[] = [];
  for (let i = 0; i < size / 2; i++) {
    const p1 = players[2 * i];
    const p2 = players[2 * i + 1];
    const isBye = p1.id === 'BYE' || p2.id === 'BYE';
    const winner = isBye ? (p1.id === 'BYE' ? p2.id : p1.id) : null;

    w1Matchups.push({
      id: `w1m${i + 1}`,
      p1: p1.id,
      p2: p2.id,
      p1Username: p1.username,
      p2Username: p2.username,
      winner,
      matchId: null,
      status: isBye ? 'COMPLETED' : 'READY',
      roundNumber: 1
    });
  }
  rounds.push({ roundNumber: 1, name: 'Winners Round 1', matchups: w1Matchups });

  // Winners Round 2 (W2)
  const w2Matchups: TournamentMatchup[] = [];
  for (let i = 0; i < size / 4; i++) {
    w2Matchups.push({
      id: `w2m${i + 1}`,
      p1: null,
      p2: null,
      winner: null,
      matchId: null,
      status: 'WAITING',
      sourceMatchups: [`w1m${2 * i + 1}`, `w1m${2 * i + 2}`],
      roundNumber: 2
    });
  }
  rounds.push({ roundNumber: 2, name: 'Winners Semifinals', matchups: w2Matchups });

  // Losers Round 1 (L1)
  const l1Matchups: TournamentMatchup[] = [];
  for (let i = 0; i < size / 4; i++) {
    l1Matchups.push({
      id: `l1m${i + 1}`,
      p1: null,
      p2: null,
      winner: null,
      matchId: null,
      status: 'WAITING',
      sourceMatchups: [`w1m${2 * i + 1}`, `w1m${2 * i + 2}`],
      sourceLosers: [`w1m${2 * i + 1}`, `w1m${2 * i + 2}`],
      roundNumber: 3
    });
  }
  rounds.push({ roundNumber: 3, name: 'Losers Round 1', matchups: l1Matchups });

  // Losers Round 2 (L2)
  const l2Matchups: TournamentMatchup[] = [];
  for (let i = 0; i < size / 4; i++) {
    const w2LoserSource = `w2m${size / 4 - i}`;
    l2Matchups.push({
      id: `l2m${i + 1}`,
      p1: null,
      p2: null,
      winner: null,
      matchId: null,
      status: 'WAITING',
      sourceMatchups: [`l1m${i + 1}`, w2LoserSource],
      sourceLosers: [w2LoserSource],
      roundNumber: 4
    });
  }
  rounds.push({ roundNumber: 4, name: 'Losers Round 2', matchups: l2Matchups });

  // Winners Round 3 (Winners Finals) (W3)
  const w3Matchups: TournamentMatchup[] = [{
    id: 'w3m1',
    p1: null,
    p2: null,
    winner: null,
    matchId: null,
    status: 'WAITING',
    sourceMatchups: ['w2m1', 'w2m2'],
    roundNumber: 5
  }];
  rounds.push({ roundNumber: 5, name: 'Winners Finals', matchups: w3Matchups });

  // Losers Round 3 (L3)
  const l3Matchups: TournamentMatchup[] = [];
  for (let i = 0; i < size / 8; i++) {
    l3Matchups.push({
      id: `l3m${i + 1}`,
      p1: null,
      p2: null,
      winner: null,
      matchId: null,
      status: 'WAITING',
      sourceMatchups: [`l2m${2 * i + 1}`, `l2m${2 * i + 2}`],
      roundNumber: 6
    });
  }
  rounds.push({ roundNumber: 6, name: 'Losers Round 3', matchups: l3Matchups });

  // Losers Round 4 (Losers Finals) (L4)
  const l4Matchups: TournamentMatchup[] = [{
    id: 'l4m1',
    p1: null,
    p2: null,
    winner: null,
    matchId: null,
    status: 'WAITING',
    sourceMatchups: ['l3m1', 'w3m1'],
    sourceLosers: ['w3m1'],
    roundNumber: 7
  }];
  rounds.push({ roundNumber: 7, name: 'Losers Finals', matchups: l4Matchups });

  // Grand Finals (GF)
  const gfMatchups: TournamentMatchup[] = [
    {
      id: 'gf1',
      p1: null,
      p2: null,
      winner: null,
      matchId: null,
      status: 'WAITING',
      sourceMatchups: ['w3m1', 'l4m1'],
      roundNumber: 8
    },
    {
      id: 'gf2',
      p1: null,
      p2: null,
      winner: null,
      matchId: null,
      status: 'WAITING',
      sourceMatchups: ['gf1'],
      roundNumber: 9
    }
  ];
  rounds.push({ roundNumber: 8, name: 'Grand Finals', matchups: gfMatchups });

  // Pre-propagate Winners Round 1 BYEs
  propagateDoubleElimBYEs(rounds, usernames);

  return rounds;
}

function propagateDoubleElimBYEs(rounds: TournamentRound[], usernames: { [id: string]: string }) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const round of rounds) {
      for (const matchup of round.matchups) {
        if (matchup.status === 'COMPLETED' && matchup.winner) {
          const loser = matchup.winner === matchup.p1 ? matchup.p2 : matchup.p1;

          for (const r of rounds) {
            for (const m of r.matchups) {
              if (m.status === 'COMPLETED') continue;

              if (m.sourceMatchups?.includes(matchup.id)) {
                const isLoserSrc = m.sourceLosers?.includes(matchup.id);
                const isP1Source = m.sourceMatchups[0] === matchup.id;

                if (isP1Source) {
                  const val = isLoserSrc ? loser : matchup.winner;
                  if (m.p1 !== val) {
                    m.p1 = val;
                    m.p1Username = usernames[val || ''] || 'BYE';
                    changed = true;
                  }
                } else {
                  const val = isLoserSrc ? loser : matchup.winner;
                  if (m.p2 !== val) {
                    m.p2 = val;
                    m.p2Username = usernames[val || ''] || 'BYE';
                    changed = true;
                  }
                }
              }

              if (m.p1 && m.p2 && m.status === 'WAITING') {
                const isNextBye = m.p1 === 'BYE' || m.p2 === 'BYE';
                if (isNextBye) {
                  m.winner = m.p1 === 'BYE' ? m.p2 : m.p1;
                  m.status = 'COMPLETED';
                } else {
                  m.status = 'READY';
                }
                changed = true;
              }
            }
          }
        }
      }
    }
  }
}

// 3. League (Round-robin)
function generateLeagueBracket(participants: any[], size: number): TournamentRound[] {
  const players = [...participants];
  while (players.length < size) {
    players.push({ id: 'BYE', username: 'BYE' });
  }

  const roundsCount = size - 1;
  const matchesPerRound = size / 2;
  const rounds: TournamentRound[] = [];

  for (let r = 0; r < roundsCount; r++) {
    const matchups: TournamentMatchup[] = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const p1Idx = (r + m) % (size - 1);
      let p2Idx = (r - m + size - 1) % (size - 1);

      if (m === 0) {
        p2Idx = size - 1;
      }

      const p1 = players[p1Idx];
      const p2 = players[p2Idx];

      const isBye = p1.id === 'BYE' || p2.id === 'BYE';
      const winner = isBye ? (p1.id === 'BYE' ? p2.id : p1.id) : null;

      matchups.push({
        id: `r${r + 1}m${m + 1}`,
        p1: p1.id,
        p2: p2.id,
        p1Username: p1.username,
        p2Username: p2.username,
        winner,
        matchId: null,
        status: isBye ? 'COMPLETED' : 'READY',
        roundNumber: r + 1
      });
    }
    rounds.push({
      roundNumber: r + 1,
      name: `Round ${r + 1}`,
      matchups
    });
  }

  return rounds;
}

// 4. Swiss (Generate Round 1 only)
function generateSwissRound1(participants: any[], size: number): TournamentRound[] {
  const players = [...participants];
  while (players.length < size) {
    players.push({ id: 'BYE', username: 'BYE' });
  }

  const matchups: TournamentMatchup[] = [];
  const matchesCount = size / 2;

  for (let i = 0; i < matchesCount; i++) {
    const p1 = players[2 * i];
    const p2 = players[2 * i + 1];
    const isBye = p1.id === 'BYE' || p2.id === 'BYE';
    const winner = isBye ? (p1.id === 'BYE' ? p2.id : p1.id) : null;

    matchups.push({
      id: `r1m${i + 1}`,
      p1: p1.id,
      p2: p2.id,
      p1Username: p1.username,
      p2Username: p2.username,
      winner,
      matchId: null,
      status: isBye ? 'COMPLETED' : 'READY',
      roundNumber: 1
    });
  }

  return [
    {
      roundNumber: 1,
      name: 'Round 1',
      matchups
    }
  ];
}

// Helper to generate Swiss matchups dynamically round-by-round
function generateNextSwissRound(
  rounds: TournamentRound[],
  participants: any[],
  currentRoundNumber: number
): TournamentRound | null {
  const scores: { [userId: string]: { wins: number; playedAgainst: string[] } } = {};
  for (const p of participants) {
    const uId = p.user_id || p.userId || p.id;
    scores[uId] = { wins: 0, playedAgainst: [] };
  }

  for (const round of rounds) {
    for (const matchup of round.matchups) {
      if (matchup.status === 'COMPLETED' && matchup.winner) {
        const winner = matchup.winner;
        const loser = winner === matchup.p1 ? matchup.p2 : matchup.p1;

        if (matchup.p1 && matchup.p1 !== 'BYE' && scores[matchup.p1]) {
          if (matchup.p2) scores[matchup.p1].playedAgainst.push(matchup.p2);
        }
        if (matchup.p2 && matchup.p2 !== 'BYE' && scores[matchup.p2]) {
          if (matchup.p1) scores[matchup.p2].playedAgainst.push(matchup.p1);
        }

        if (scores[winner]) {
          scores[winner].wins++;
        }
      }
    }
  }

  const sortedPlayers = [...participants].sort((a, b) => {
    const uA = a.user_id || a.userId || a.id;
    const uB = b.user_id || b.userId || b.id;
    const winsA = scores[uA]?.wins || 0;
    const winsB = scores[uB]?.wins || 0;
    return winsB - winsA;
  });

  const nextRoundNumber = currentRoundNumber + 1;
  const matchups: TournamentMatchup[] = [];
  const paired = new Set<string>();

  if (sortedPlayers.length % 2 !== 0) {
    let byePlayerIndex = sortedPlayers.length - 1;
    while (byePlayerIndex >= 0) {
      const pId = sortedPlayers[byePlayerIndex].user_id || sortedPlayers[byePlayerIndex].userId || sortedPlayers[byePlayerIndex].id;
      const hadBye = scores[pId]?.playedAgainst.includes('BYE');
      if (!hadBye) {
        break;
      }
      byePlayerIndex--;
    }
    if (byePlayerIndex < 0) byePlayerIndex = sortedPlayers.length - 1;

    const byePlayer = sortedPlayers[byePlayerIndex];
    const bpId = byePlayer.user_id || byePlayer.userId || byePlayer.id;
    paired.add(bpId);

    matchups.push({
      id: `r${nextRoundNumber}mBYE`,
      p1: bpId,
      p2: 'BYE',
      p1Username: byePlayer.username || byePlayer.profiles?.username || 'Player',
      p2Username: 'BYE',
      winner: bpId,
      matchId: null,
      status: 'COMPLETED',
      roundNumber: nextRoundNumber
    });
    sortedPlayers.splice(byePlayerIndex, 1);
  }

  let matchupCount = 1;
  for (let i = 0; i < sortedPlayers.length; i++) {
    const p1 = sortedPlayers[i];
    const p1Id = p1.user_id || p1.userId || p1.id;
    if (paired.has(p1Id)) continue;

    let oppIndex = -1;
    for (let j = i + 1; j < sortedPlayers.length; j++) {
      const p2 = sortedPlayers[j];
      const p2Id = p2.user_id || p2.userId || p2.id;
      if (paired.has(p2Id)) continue;

      const alreadyPlayed = scores[p1Id]?.playedAgainst.includes(p2Id);
      if (!alreadyPlayed) {
        oppIndex = j;
        break;
      }
    }

    if (oppIndex === -1) {
      for (let j = i + 1; j < sortedPlayers.length; j++) {
        const p2Id = sortedPlayers[j].user_id || sortedPlayers[j].userId || sortedPlayers[j].id;
        if (!paired.has(p2Id)) {
          oppIndex = j;
          break;
        }
      }
    }

    if (oppIndex !== -1) {
      const p2 = sortedPlayers[oppIndex];
      const p2Id = p2.user_id || p2.userId || p2.id;
      paired.add(p1Id);
      paired.add(p2Id);

      matchups.push({
        id: `r${nextRoundNumber}m${matchupCount++}`,
        p1: p1Id,
        p2: p2Id,
        p1Username: p1.username || p1.profiles?.username || 'Player',
        p2Username: p2.username || p2.profiles?.username || 'Player',
        winner: null,
        matchId: null,
        status: 'WAITING',
        roundNumber: nextRoundNumber
      });
    }
  }

  return {
    roundNumber: nextRoundNumber,
    name: `Round ${nextRoundNumber}`,
    matchups
  };
}

// Helper to propagate winners and losers in Single/Double Elimination brackets
function propagateResult(
  rounds: TournamentRound[],
  completedMatchupId: string,
  winnerId: string,
  loserId: string | null,
  usernames: { [id: string]: string }
) {
  for (const round of rounds) {
    for (const matchup of round.matchups) {
      if (matchup.status === 'COMPLETED') continue;

      if (matchup.sourceMatchups?.includes(completedMatchupId)) {
        const isLoserSrc = matchup.sourceLosers?.includes(completedMatchupId);
        const targetVal = isLoserSrc ? loserId : winnerId;
        const targetUsername = targetVal ? usernames[targetVal] : 'BYE';

        const isP1Source = matchup.sourceMatchups[0] === completedMatchupId;
        if (isP1Source) {
          matchup.p1 = targetVal;
          matchup.p1Username = targetUsername;
        } else {
          matchup.p2 = targetVal;
          matchup.p2Username = targetUsername;
        }

        if (matchup.p1 && matchup.p2) {
          const isNextBye = matchup.p1 === 'BYE' || matchup.p2 === 'BYE';
          if (isNextBye) {
            matchup.winner = matchup.p1 === 'BYE' ? matchup.p2 : matchup.p1;
            matchup.status = 'COMPLETED';
            propagateResult(rounds, matchup.id, matchup.winner!, matchup.winner === matchup.p1 ? matchup.p2 : matchup.p1, usernames);
          } else {
            matchup.status = 'READY';
          }
        }
      }
    }
  }
}

// ============================================================================
// REST API ENDPOINTS & LOGIC
// ============================================================================

// 1. List all tournaments
router.get('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: tournaments, error } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const formattedTournaments = await Promise.all((tournaments || []).map(async (t: any) => {
      const { count } = await supabaseAdmin
        .from('tournament_participants')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', t.id);

      return {
        ...t,
        participantsCount: count || 0
      };
    }));

    return res.json(formattedTournaments);
  } catch (err) {
    console.error('List tournaments error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Create tournament
router.post('/', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { name, description, format, bracketSize, entryFeeCoins, entryFeeTokens, prizePool } = req.body;
  const userId = req.profile?.id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!name || !format || !bracketSize) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const feeTokens = Number(entryFeeTokens || 0);

  try {
    if (feeTokens > 0) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('creator_tokens')
        .eq('id', userId)
        .single();

      if (!profile || profile.creator_tokens < feeTokens) {
        return res.status(400).json({ error: 'Insufficient Creator Tokens' });
      }

      await supabaseAdmin
        .from('profiles')
        .update({ creator_tokens: profile.creator_tokens - feeTokens })
        .eq('id', userId);
    }

    const { data: tournament, error } = await supabaseAdmin
      .from('tournaments')
      .insert({
        name,
        description,
        format,
        bracket_size: Number(bracketSize),
        status: 'REGISTRATION',
        entry_fee_coins: Number(entryFeeCoins || 0),
        entry_fee_tokens: feeTokens,
        prize_pool: prizePool || { first_place_tokens: 10 },
        created_by: userId
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json(tournament);
  } catch (err) {
    console.error('Create tournament error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to auto-create room and notify players
export async function activateMatchupRoom(tournamentId: string, matchup: TournamentMatchup) {
  if (!matchup.p1 || !matchup.p2 || matchup.p1 === 'BYE' || matchup.p2 === 'BYE') return;

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  try {
    const { data: room, error: roomError } = await supabaseAdmin
      .from('rooms')
      .insert({
        code,
        host_id: matchup.p1,
        type: 'PRIVATE',
        status: 'WAITING',
        config: {
          mode: 'FREE_FOR_ALL',
          maxPlayers: 2,
          roundsCount: 5,
          questionTimeLimitSeconds: 20,
          buzzerType: 'STANDARD',
          allowedPowerUps: ['JOKER', 'FREEZE', 'SHIELD', 'REVEAL_HINT', 'DOUBLE_CHANCE'],
          categoryWeights: { 'General': 100 }
        },
        max_players: 2,
        current_round: 0
      })
      .select()
      .single();

    if (roomError || !room) {
      console.error('Error creating tournament room:', roomError);
      return;
    }

    await supabaseAdmin.from('room_participants').insert([
      { room_id: room.id, user_id: matchup.p1, is_host: true, is_ready: true, score: 0 },
      { room_id: room.id, user_id: matchup.p2, is_host: false, is_ready: true, score: 0 }
    ]);

    await supabaseAdmin.from('tournament_matches').insert({
      tournament_id: tournamentId,
      match_id: room.id,
      bracket_round: matchup.roundNumber,
      bracket_position: parseInt(matchup.id.replace(/\D/g, '') || '1')
    });

    matchup.matchId = room.id;
    matchup.roomCode = code;
    matchup.status = 'PLAYING';

    io.to(matchup.p1).emit('tournament:match_ready', { tournamentId, roomId: room.id, code, opponent: matchup.p2Username });
    io.to(matchup.p2).emit('tournament:match_ready', { tournamentId, roomId: room.id, code, opponent: matchup.p1Username });
  } catch (err) {
    console.error('Exception activating matchup room:', err);
  }
}

// 3. Get single tournament details
router.get('/:id', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const { data: tournament, error } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { data: participants } = await supabaseAdmin
      .from('tournament_participants')
      .select(`
        id,
        user_id,
        seed,
        is_eliminated,
        wins,
        losses,
        profiles (
          username,
          avatar_url,
          rank
        )
      `)
      .eq('tournament_id', id);

    const formattedParticipants = (participants || []).map((p: any) => ({
      id: p.id,
      userId: p.user_id,
      username: p.profiles?.username || 'Player',
      avatarUrl: p.profiles?.avatar_url || null,
      rank: p.profiles?.rank || 'Bronze',
      seed: p.seed,
      isEliminated: p.is_eliminated,
      wins: p.wins,
      losses: p.losses
    }));

    return res.json({
      ...tournament,
      participants: formattedParticipants
    });
  } catch (err) {
    console.error('Get tournament details error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. Register for a tournament
router.post('/:id/register', requireAuth as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.profile?.id;

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: tournament, error: tErr } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (tErr || !tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.status !== 'REGISTRATION') {
      return res.status(400).json({ error: 'Tournament registration closed' });
    }

    const { data: participants, error: pErr } = await supabaseAdmin
      .from('tournament_participants')
      .select('user_id')
      .eq('tournament_id', id);

    if (pErr) return res.status(500).json({ error: pErr.message });

    if (participants.some((p: any) => p.user_id === userId)) {
      return res.status(400).json({ error: 'Already registered' });
    }

    if (participants.length >= tournament.bracket_size) {
      return res.status(400).json({ error: 'Tournament is full' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('coins, creator_tokens')
      .eq('id', userId)
      .single();

    if (!profile) return res.status(404).json({ error: 'User profile not found' });

    const feeCoins = tournament.entry_fee_coins || 0;
    const feeTokens = tournament.entry_fee_tokens || 0;

    if (profile.coins < feeCoins || profile.creator_tokens < feeTokens) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    await supabaseAdmin
      .from('profiles')
      .update({
        coins: profile.coins - feeCoins,
        creator_tokens: profile.creator_tokens - feeTokens
      })
      .eq('id', userId);

    const { error: regErr } = await supabaseAdmin
      .from('tournament_participants')
      .insert({
        tournament_id: id,
        user_id: userId,
        seed: participants.length + 1
      });

    if (regErr) return res.status(500).json({ error: regErr.message });

    const newCount = participants.length + 1;
    if (newCount === tournament.bracket_size) {
      const allParts = [
        ...participants.map((p: any, idx: number) => ({ id: p.user_id, username: `Player ${idx + 1}` })),
        { id: userId, username: req.profile?.username || 'Player' }
      ];

      const partIds = allParts.map(p => p.id);
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, username')
        .in('id', partIds);

      const profileMap: { [id: string]: string } = {};
      if (profiles) {
        profiles.forEach((pr: any) => {
          profileMap[pr.id] = pr.username;
        });
      }

      const formattedParts = allParts.map(p => ({
        id: p.id,
        username: profileMap[p.id] || p.username
      }));

      let bracket: TournamentRound[] = [];
      const fmt: TournamentFormat = tournament.format;

      if (fmt === 'KNOCKOUT') {
        bracket = generateKnockoutBracket(formattedParts, tournament.bracket_size);
      } else if (fmt === 'DOUBLE_ELIMINATION') {
        bracket = generateDoubleEliminationBracket(formattedParts, tournament.bracket_size);
      } else if (fmt === 'LEAGUE') {
        bracket = generateLeagueBracket(formattedParts, tournament.bracket_size);
      } else if (fmt === 'SWISS') {
        bracket = generateSwissRound1(formattedParts, tournament.bracket_size);
      }

      for (const round of bracket) {
        for (const matchup of round.matchups) {
          if (matchup.status === 'READY') {
            await activateMatchupRoom(id, matchup);
          }
        }
      }

      await supabaseAdmin
        .from('tournaments')
        .update({
          status: 'IN_PROGRESS',
          bracket,
          starts_at: new Date().toISOString()
        })
        .eq('id', id);

      io.to(id).emit('tournament:started', { tournamentId: id, format: fmt });
    }

    io.to(id).emit('tournament:update', { tournamentId: id });

    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Register tournament error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// Automated Bracket Progression Engine (Triggered on Match Completion)
// ============================================================================
export async function handleTournamentMatchCompletion(roomId: string, winnerId: string | null) {
  try {
    const { data: tourMatch, error: mErr } = await supabaseAdmin
      .from('tournament_matches')
      .select('*')
      .eq('match_id', roomId)
      .maybeSingle();

    if (mErr || !tourMatch) return;

    const { tournament_id: tournamentId } = tourMatch;

    await supabaseAdmin
      .from('tournament_matches')
      .update({ winner_id: winnerId })
      .eq('match_id', roomId);

    const { data: tournament, error: tErr } = await supabaseAdmin
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .single();

    if (tErr || !tournament) return;

    let bracket: TournamentRound[] = tournament.bracket || [];
    const format: TournamentFormat = tournament.format;

    let completedMatchup: TournamentMatchup | null = null;
    for (const round of bracket) {
      for (const matchup of round.matchups) {
        if (matchup.matchId === roomId) {
          matchup.winner = winnerId;
          matchup.status = 'COMPLETED';
          completedMatchup = matchup;
          break;
        }
      }
      if (completedMatchup) break;
    }

    if (!completedMatchup) return;

    const p1 = completedMatchup.p1;
    const p2 = completedMatchup.p2;
    const loserId = winnerId === p1 ? p2 : p1;

    if (winnerId && winnerId !== 'BYE') {
      const { data: partWinner } = await supabaseAdmin
        .from('tournament_participants')
        .select('wins')
        .eq('tournament_id', tournamentId)
        .eq('user_id', winnerId)
        .single();
      if (partWinner) {
        await supabaseAdmin
          .from('tournament_participants')
          .update({ wins: partWinner.wins + 1 })
          .eq('tournament_id', tournamentId)
          .eq('user_id', winnerId);
      }
    }

    if (loserId && loserId !== 'BYE') {
      const { data: partLoser } = await supabaseAdmin
        .from('tournament_participants')
        .select('losses')
        .eq('tournament_id', tournamentId)
        .eq('user_id', loserId)
        .single();
      if (partLoser) {
        await supabaseAdmin
          .from('tournament_participants')
          .update({ losses: partLoser.losses + 1 })
          .eq('tournament_id', tournamentId)
          .eq('user_id', loserId);
      }
    }

    const { data: participants } = await supabaseAdmin
      .from('tournament_participants')
      .select('user_id, profiles (username)')
      .eq('tournament_id', tournamentId);

    const usernames: { [id: string]: string } = { BYE: 'BYE' };
    if (participants) {
      participants.forEach((p: any) => {
        usernames[p.user_id] = p.profiles?.username || 'Player';
      });
    }

    let tournamentCompleted = false;
    let finalWinnerId: string | null = null;

    if (format === 'KNOCKOUT') {
      propagateResult(bracket, completedMatchup.id, winnerId || '', loserId, usernames);

      const finalRound = bracket[bracket.length - 1];
      const finalsMatch = finalRound.matchups[0];
      if (finalsMatch.status === 'COMPLETED') {
        tournamentCompleted = true;
        finalWinnerId = finalsMatch.winner;
      }
    } else if (format === 'DOUBLE_ELIMINATION') {
      if (completedMatchup.id === 'gf1') {
        if (winnerId === completedMatchup.p2) {
          const gf2 = bracket[bracket.length - 1].matchups.find((m: TournamentMatchup) => m.id === 'gf2');
          if (gf2) {
            gf2.p1 = completedMatchup.p1;
            gf2.p2 = completedMatchup.p2;
            gf2.p1Username = completedMatchup.p1Username;
            gf2.p2Username = completedMatchup.p2Username;
            gf2.status = 'READY';
          }
        } else {
          const gf2 = bracket[bracket.length - 1].matchups.find((m: TournamentMatchup) => m.id === 'gf2');
          if (gf2) {
            gf2.status = 'COMPLETED';
            gf2.winner = winnerId;
          }
          tournamentCompleted = true;
          finalWinnerId = winnerId;
        }
      } else if (completedMatchup.id === 'gf2') {
        tournamentCompleted = true;
        finalWinnerId = winnerId;
      } else {
        propagateResult(bracket, completedMatchup.id, winnerId || '', loserId, usernames);
      }
    } else if (format === 'LEAGUE') {
      const allDone = bracket.every(round => round.matchups.every((m: TournamentMatchup) => m.status === 'COMPLETED'));
      if (allDone) {
        tournamentCompleted = true;
        const { data: standings } = await supabaseAdmin
          .from('tournament_participants')
          .select('user_id, wins')
          .eq('tournament_id', tournamentId)
          .order('wins', { ascending: false });

        if (standings && standings.length > 0) {
          finalWinnerId = standings[0].user_id;
        }
      }
    } else if (format === 'SWISS') {
      const currentRoundNum = completedMatchup.roundNumber;
      const currentRound = bracket.find(r => r.roundNumber === currentRoundNum);
      const allDone = currentRound?.matchups.every((m: TournamentMatchup) => m.status === 'COMPLETED');

      if (allDone) {
        const totalRounds = Math.log2(tournament.bracket_size);
        if (currentRoundNum >= totalRounds) {
          tournamentCompleted = true;
          const { data: standings } = await supabaseAdmin
            .from('tournament_participants')
            .select('user_id, wins')
            .eq('tournament_id', tournamentId)
            .order('wins', { ascending: false });

          if (standings && standings.length > 0) {
            finalWinnerId = standings[0].user_id;
          }
        } else {
          const nextRound = generateNextSwissRound(bracket, participants, currentRoundNum);
          if (nextRound) {
            bracket.push(nextRound);
          }
        }
      }
    }

    for (const round of bracket) {
      for (const matchup of round.matchups) {
        if (matchup.status === 'READY') {
          await activateMatchupRoom(tournamentId, matchup);
        }
      }
    }

    if (tournamentCompleted && finalWinnerId) {
      const firstPlaceTokens = tournament.prize_pool?.first_place_tokens || 10;
      const { data: winnerProfile } = await supabaseAdmin
        .from('profiles')
        .select('creator_tokens')
        .eq('id', finalWinnerId)
        .single();

      if (winnerProfile) {
        await supabaseAdmin
          .from('profiles')
          .update({ creator_tokens: winnerProfile.creator_tokens + firstPlaceTokens })
          .eq('id', finalWinnerId);
      }

      // Award Tournament King badge if the winner has 0 losses
      const { data: participant } = await supabaseAdmin
        .from('tournament_participants')
        .select('losses')
        .eq('tournament_id', tournamentId)
        .eq('user_id', finalWinnerId)
        .single();
      
      if (participant && Number(participant.losses || 0) === 0) {
        const { data: badge } = await supabaseAdmin
          .from('badges')
          .select('id')
          .eq('key', 'tournament_king')
          .single();
        if (badge) {
          await supabaseAdmin
            .from('badges_earned')
            .insert({ user_id: finalWinnerId, badge_id: badge.id })
            .select()
            .maybeSingle();
        }
      }

      await supabaseAdmin
        .from('tournaments')
        .update({
          status: 'COMPLETED',
          bracket,
          ends_at: new Date().toISOString()
        })
        .eq('id', tournamentId);
    } else {
      await supabaseAdmin
        .from('tournaments')
        .update({ bracket })
        .eq('id', tournamentId);
    }

    io.to(tournamentId).emit('tournament:update', { tournamentId });
  } catch (err) {
    console.error('Exception handling tournament match completion:', err);
  }
}

export default router;
