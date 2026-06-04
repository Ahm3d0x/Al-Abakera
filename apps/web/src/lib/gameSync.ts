import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Participant } from "@mind-race/shared";

export type GameSyncCallbacks = {
  onParticipantsUpdate?: (participants: Participant[]) => void;
  onConfigUpdate?: (config: any) => void;
  onGameStart?: (data: { roomId: string }) => void;
  onRoundStart?: (data: {
    roundId: string;
    roundIndex: number;
    totalRounds: number;
    question: any;
    timeLeft: number;
    scores: { [userId: string]: number };
  }) => void;
  onTick?: (data: { timeLeft: number }) => void;
  onBuzzed?: (data: { userId: string; username: string }) => void;
  onBuzzerReset?: () => void;
  onRoundEnded?: (data: {
    userId: string | null;
    isCorrect: boolean;
    correctAnswer: any;
    explanation: string;
    scores: { [userId: string]: number };
  }) => void;
  onGameEnded?: (data: {
    scores: { [userId: string]: number };
    winnerId: string | null;
    winnerName: string;
  }) => void;
  onPowerUpUsed?: (data: { userId: string; powerUpType: string; targetUserId?: string }) => void;
  onChatMessage?: (data: { userId: string; username: string; message: string; teamId?: string | null }) => void;
};

export class GameSyncService {
  private roomId: string;
  private userId: string;
  private username: string;
  private isHost: boolean = false;
  private channel: RealtimeChannel | null = null;
  private callbacks: GameSyncCallbacks = {};
  public activeParticipants: Participant[] = [];
  
  // Local timer state for round ticking
  private roundTimer: NodeJS.Timeout | null = null;
  private roundTimeLimit: number = 30;
  private roundTimeLeft: number = 30;
  private roundStartedAt: string | null = null;
  private roomStatus: string = "WAITING";

  constructor(roomId: string, userId: string, username: string, isHost: boolean) {
    this.roomId = roomId;
    this.userId = userId;
    this.username = username;
    this.isHost = isHost;
  }


  /**
   * Set callback hooks for game events
   */
  public setCallbacks(callbacks: GameSyncCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Initialize Supabase Realtime Presence, Broadcast, and DB Change Listeners
   */
  public async connect() {
    console.log(`[GameSync] Connecting to room ${this.roomId}...`);

    // Fetch initial room status
    try {
      const { data: roomData } = await supabase
        .from("rooms")
        .select("status")
        .eq("id", this.roomId)
        .maybeSingle();
      if (roomData) {
        this.roomStatus = roomData.status;
      }
    } catch (e) {
      console.warn("[GameSync] Could not fetch initial room status:", e);
    }


    // 1. Create a channel for this specific room
    const channelName = `room_channel:${this.roomId}`;
    this.channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: this.userId,
        },
      },
    });

    // 2. Setup Presence listeners to track who is in the room
    this.channel
      .on("presence", { event: "sync" }, () => {
        const presenceState = this.channel!.presenceState();
        this.handlePresenceSync(presenceState);
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        console.log(`[GameSync] Presence join:`, key, newPresences);
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
        console.log(`[GameSync] Presence leave:`, key, leftPresences);
        this.handlePlayerDisconnect(key);
      });

    // 3. Setup Broadcast listeners for instant/ephemeral multiplayer actions
    this.channel
      .on("broadcast", { event: "game_timer_tick" }, ({ payload }) => {
        if (!this.isHost && this.callbacks.onTick) {
          this.callbacks.onTick({ timeLeft: payload.timeLeft });
        }
      })
      .on("broadcast", { event: "power_up_triggered" }, ({ payload }) => {
        if (this.callbacks.onPowerUpUsed) {
          this.callbacks.onPowerUpUsed(payload);
        }
      })
      .on("broadcast", { event: "chat_message" }, ({ payload }) => {
        if (this.callbacks.onChatMessage) {
          this.callbacks.onChatMessage(payload);
        }
      });

    // 4. Setup Postgres Changes listeners to observe database modifications
    this.channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${this.roomId}`,
        },
        async (payload: any) => {
          console.log("[GameSync] Rooms change received:", payload);
          const room = payload.new;
          if (!room) return;

          // Config changes
          if (this.callbacks.onConfigUpdate && payload.old?.config !== room.config) {
            this.callbacks.onConfigUpdate(room.config);
          }

          // Game start / status transition to ACTIVE
          if ((payload.old?.status === "WAITING" || this.roomStatus === "WAITING") && room.status === "ACTIVE") {
            this.roomStatus = "ACTIVE";
            if (this.callbacks.onGameStart) {
              this.callbacks.onGameStart({ roomId: this.roomId });
            }
          }


          // Host change or current round index changes
          if (room.host_id === this.userId) {
            this.isHost = true;
          } else {
            this.isHost = false;
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_participants",
          filter: `room_id=eq.${this.roomId}`,
        },
        async () => {
          // Whenever participants tables changes, fetch and broadcast
          await this.syncParticipantsFromDB();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "match_rounds",
        },
        async (payload: any) => {
          const round = payload.new;
          // Verify if this round is linked to our active match
          const { data: match } = await supabase
            .from("matches")
            .select("id")
            .eq("room_id", this.roomId)
            .eq("status", "ACTIVE")
            .maybeSingle();

          if (match && round.match_id === match.id) {
            this.handleRoundStart(round);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "match_rounds",
        },
        async (payload: any) => {
          const round = payload.new;
          const { data: match } = await supabase
            .from("matches")
            .select("id")
            .eq("room_id", this.roomId)
            .eq("status", "ACTIVE")
            .maybeSingle();

          if (match && round.match_id === match.id) {
            // Check if buzzer was claimed or stolen
            if (payload.old?.buzzed_player_id !== round.buzzed_player_id && round.buzzed_player_id !== null) {
              this.handleBuzzedEvent(round);
            }
            // Check if buzzer was reset (COMPETITIVE mode wrong answer)
            if (payload.old?.buzzed_player_id !== null && round.buzzed_player_id === null) {
              this.handleBuzzerReset();
            }
            // Check if round ended
            if (payload.old?.ended_at === null && round.ended_at !== null) {
              await this.handleRoundEnd(round);
            }
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `room_id=eq.${this.roomId}`,
        },
        async (payload: any) => {
          const match = payload.new;
          if (match && match.status === "ENDED") {
            await this.handleMatchEnd(match.id);
          }
        }
      );

    // 5. Subscribe and Track presence
    this.channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        console.log(`[GameSync] Successfully subscribed to Realtime channel.`);
        await this.channel!.track({
          userId: this.userId,
          username: this.username,
          isOnline: true,
          isHost: this.isHost,
        });
      }
    });

    // Run initial sync of participants from DB
    await this.syncParticipantsFromDB();
  }

  /**
   * Clean up and unsubscribe
   */
  public disconnect() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
  }

  /**
   * Sync participants list from the database
   */
  public async syncParticipantsFromDB() {
    try {
      const { data: dbParticipants, error } = await supabase
        .from("room_participants")
        .select(`
          score,
          is_host,
          is_ready,
          team_id,
          is_spectator,
          user_id,
          profiles (
            username,
            avatar_url,
            rank
          )
        `)
        .eq("room_id", this.roomId);

      if (error) {
        console.error("[GameSync] Error fetching participants:", error);
        return;
      }

      this.activeParticipants = (dbParticipants || []).map((p: any) => ({
        userId: p.user_id,
        username: p.profiles?.username || "Player",
        avatarUrl: p.profiles?.avatar_url || null,
        rank: p.profiles?.rank || "Bronze",
        score: p.score,
        isHost: p.is_host,
        isReady: p.is_ready,
        teamId: p.team_id,
        isSpectator: p.is_spectator,
      }));

      // Find if local client is host
      const self = this.activeParticipants.find(p => p.userId === this.userId);
      if (self) {
        this.isHost = self.isHost;
      }

      if (this.callbacks.onParticipantsUpdate) {
        this.callbacks.onParticipantsUpdate(this.activeParticipants);
      }
    } catch (err) {
      console.error("[GameSync] Exception syncing participants:", err);
    }
  }

  /**
   * Handles Presence updates. We can use this to double-check online statuses.
   */
  private handlePresenceSync(presenceState: any) {
    console.log("[GameSync] Online presences synced:", presenceState);
  }

  /**
   * Self-healing lobby logic: Clean up offline players or reassign Host if host disconnected.
   */
  private async handlePlayerDisconnect(leftUserId: string) {
    if (!this.isHost) return; // Only host handles disconnect database cleanup

    console.log(`[GameSync] Cleaning up disconnected user: ${leftUserId}`);
    try {
      // 1. Remove left player from database participants
      await supabase
        .from("room_participants")
        .delete()
        .eq("room_id", this.roomId)
        .eq("user_id", leftUserId);

      // If the player who left was the host (meaning we are executing this but wait...
      // if the host left, another client has to promote themselves. Let's write that below)
    } catch (err) {
      console.error("[GameSync] Error deleting disconnected participant:", err);
    }

    // 2. Re-evaluate host promotion if host went offline
    const hostStillOnline = this.activeParticipants.some(p => p.userId === this.userId && p.isHost);
    if (!hostStillOnline && this.activeParticipants.length > 0) {
      // Sort participants by joined time or alphabetical, first one promotes themselves
      const eligible = this.activeParticipants.filter(p => !p.isSpectator);
      if (eligible.length > 0 && eligible[0].userId === this.userId) {
        console.log(`[GameSync] Former host went offline. Promoting self (${this.username}) to Host.`);
        this.isHost = true;
        await supabase.from("rooms").update({ host_id: this.userId }).eq("id", this.roomId);
        await supabase
          .from("room_participants")
          .update({ is_host: true, is_ready: true })
          .eq("room_id", this.roomId)
          .eq("user_id", this.userId);
      }
    }
  }

  /**
   * Broadcast local countdown ticks (Host Client only)
   */
  private startLocalTickBroadcast(timeLimit: number) {
    if (this.roundTimer) clearInterval(this.roundTimer);

    this.roundTimeLeft = timeLimit;
    
    this.roundTimer = setInterval(async () => {
      this.roundTimeLeft--;
      
      // If host, broadcast tick to other clients
      if (this.isHost && this.channel) {
        this.channel.send({
          type: "broadcast",
          event: "game_timer_tick",
          payload: { timeLeft: this.roundTimeLeft },
        });
      }

      if (this.callbacks.onTick) {
        this.callbacks.onTick({ timeLeft: this.roundTimeLeft });
      }

      if (this.roundTimeLeft <= 0) {
        clearInterval(this.roundTimer!);
        if (this.isHost) {
          // Host automatically ends the round
          await this.forceEndRound();
        }
      }
    }, 1000);
  }

  /**
   * Handle when a new round SQL row is inserted
   */
  private async handleRoundStart(round: any) {
    if (this.roundTimer) clearInterval(this.roundTimer);

    // Fetch full question text (safe select since trigger hides answers on clients)
    const { data: q } = await supabase
      .from("questions")
      .select("id, type, category, body, image_url, options, difficulty, rating, explanation")
      .eq("id", round.question_id)
      .single();

    if (!q) return;

    // Fetch match config limit
    const { data: match } = await supabase
      .from("matches")
      .select("config, total_rounds")
      .eq("id", round.match_id)
      .single();

    const timeLimit = match ? coalesce((match.config?.questionTimeLimitSeconds), 30) : 30;
    this.roundTimeLimit = timeLimit;

    // Map DB round object to GameEvents round structure
    if (this.callbacks.onRoundStart) {
      const scoreMap: { [userId: string]: number } = {};
      this.activeParticipants.forEach(p => {
        scoreMap[p.userId] = p.score;
      });

      this.callbacks.onRoundStart({
        roundId: round.id,
        roundIndex: round.round_number,
        totalRounds: match ? match.total_rounds : 5,
        question: {
          id: q.id,
          type: q.type,
          category: q.category,
          body: q.body,
          imageUrl: q.image_url,
          options: q.options,
          difficulty: q.difficulty,
          rating: Number(q.rating || 0),
          explanation: q.explanation,
        },
        timeLeft: timeLimit,
        scores: scoreMap,
      });
    }

    // Start local countdown
    this.startLocalTickBroadcast(timeLimit);
  }

  /**
   * Handle when a buzzer is claimed in the database
   */
  private async handleBuzzedEvent(round: any) {
    // If buzzer claimed, limit answering time left for buzzed player to 10s
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.startLocalTickBroadcast(10);

    if (this.callbacks.onBuzzed) {
      // Find buzzed username
      const buzzedPlayer = this.activeParticipants.find(p => p.userId === round.buzzed_player_id);
      this.callbacks.onBuzzed({
        userId: round.buzzed_player_id,
        username: buzzedPlayer?.username || "Player",
      });
    }
  }

  private handleBuzzerReset() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    if (this.callbacks.onBuzzerReset) {
      this.callbacks.onBuzzerReset();
    }
  }

  /**
   * Handle round completion
   */
  private async handleRoundEnd(round: any) {
    if (this.roundTimer) clearInterval(this.roundTimer);

    // Fetch round results: who answered, what correct answer is
    const { data: question } = await supabase
      .from("questions")
      .select("correct_answer, explanation, ordering_items, matching_pairs")
      .eq("id", round.question_id)
      .single();

    if (!question) return;

    // Fetch round answer details
    const { data: answers } = await supabase
      .from("round_answers")
      .select("user_id, is_correct")
      .eq("round_id", round.id);

    const buzzerWinnerAnswer = answers?.find(a => a.user_id === round.buzzed_player_id);
    const isCorrect = buzzerWinnerAnswer ? buzzerWinnerAnswer.is_correct : false;

    // Refresh scores from participant list
    await this.syncParticipantsFromDB();

    const scoreMap: { [userId: string]: number } = {};
    this.activeParticipants.forEach(p => {
      scoreMap[p.userId] = p.score;
    });

    if (this.callbacks.onRoundEnded) {
      this.callbacks.onRoundEnded({
        userId: round.buzzed_player_id,
        isCorrect,
        correctAnswer: question.correct_answer || question.ordering_items || question.matching_pairs,
        explanation: question.explanation || "",
        scores: scoreMap,
      });
    }

    // Host schedules next round transition after 4s cinematic delay
    if (this.isHost) {
      setTimeout(async () => {
        await this.advanceToNextRound(round);
      }, 4000);
    }
  }

  /**
   * Handle final match completion
   */
  private async handleMatchEnd(_matchId: string) {
    await this.syncParticipantsFromDB();

    const scoreMap: { [userId: string]: number } = {};
    this.activeParticipants.forEach(p => {
      scoreMap[p.userId] = p.score;
    });

    // Find winner
    let winnerId: string | null = null;
    let maxScore = -1;
    this.activeParticipants.forEach(p => {
      if (p.score > maxScore) {
        maxScore = p.score;
        winnerId = p.userId;
      }
    });

    const winner = this.activeParticipants.find(p => p.userId === winnerId);

    if (this.callbacks.onGameEnded) {
      this.callbacks.onGameEnded({
        scores: scoreMap,
        winnerId,
        winnerName: winner?.username || "Opponent",
      });
    }
  }

  /**
   * Host action: Advance to the next round or end game
   */
  private async advanceToNextRound(currentRoundObj: any) {
    const { data: match } = await supabase
      .from("matches")
      .select("*")
      .eq("room_id", this.roomId)
      .eq("status", "ACTIVE")
      .single();

    if (!match) return;

    const nextRoundIndex = currentRoundObj.round_number + 1;
    
    // Fetch room rounds limit
    const { data: room } = await supabase
      .from("rooms")
      .select("config")
      .eq("id", this.roomId)
      .single();

    const roundsLimit = room ? coalesce(room.config?.roundsCount, 5) : 5;

    if (nextRoundIndex >= roundsLimit) {
      // 1. Save final scores in room_participants
      for (const p of this.activeParticipants) {
        await supabase
          .from("room_participants")
          .update({ score: p.score })
          .eq("room_id", this.roomId)
          .eq("user_id", p.userId);
      }

      // 2. Set matches status to ENDED
      await supabase
        .from("matches")
        .update({
          status: "ENDED",
          ended_at: new Date().toISOString(),
        })
        .eq("id", match.id);

      // 3. Set rooms status to ENDED
      await supabase
        .from("rooms")
        .update({ status: "ENDED" })
        .eq("id", this.roomId);
    } else {
      // Fetch list of match rounds to figure out what question to pick next
      const { data: existingRounds } = await supabase
        .from("match_rounds")
        .select("question_id")
        .eq("match_id", match.id);

      const excludeIds = existingRounds?.map(r => r.question_id) || [];

      // ── Category Weighting Support ──────────────────────────────────────
      // If the room config has categoryWeights (e.g. {"Science": 50, "Math": 30}),
      // pick from the weighted category using a random roll.
      const categoryWeights: { [cat: string]: number } = room?.config?.categoryWeights || {};
      const weightEntries = Object.entries(categoryWeights).filter(([, w]) => w > 0);

      let selectedCategory: string | null = null;
      if (weightEntries.length > 0) {
        const totalWeight = weightEntries.reduce((sum, [, w]) => sum + w, 0);
        let roll = Math.random() * totalWeight;
        for (const [cat, w] of weightEntries) {
          roll -= w;
          if (roll <= 0) {
            selectedCategory = cat;
            break;
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────

      // Build question query, excluding already-used questions
      let qQuery = supabase.from("questions").select("id");
      if (excludeIds.length > 0) {
        qQuery = qQuery.not("id", "in", `(${excludeIds.join(",")})`);
      }
      if (selectedCategory) {
        qQuery = qQuery.ilike("category", `%${selectedCategory}%`);
      }
      qQuery = qQuery.limit(20); // Fetch up to 20 candidates, pick one randomly

      const { data: dbQs } = await qQuery;
      let nextQId: string | null = null;
      if (dbQs && dbQs.length > 0) {
        // Pick randomly from candidates to avoid always getting the first inserted question
        nextQId = dbQs[Math.floor(Math.random() * dbQs.length)].id;
      }

      if (!nextQId) {
        // Fallback: try without category filter or exclusions if pool is exhausted
        const { data: fallbackQ } = await supabase
          .from("questions")
          .select("id")
          .limit(20);
        if (fallbackQ && fallbackQ.length > 0) {
          nextQId = fallbackQ[Math.floor(Math.random() * fallbackQ.length)].id;
        }
      }

      if (nextQId) {
        // Insert next round row
        await supabase.from("match_rounds").insert({
          match_id: match.id,
          round_number: nextRoundIndex,
          question_id: nextQId,
          started_at: new Date().toISOString(),
        });

        // Update room round count
        await supabase
          .from("rooms")
          .update({ current_round: nextRoundIndex })
          .eq("id", this.roomId);
      }
    }
  }

  /**
   * Host action: End round manually when timer runs out
   */
  private async forceEndRound() {
    try {
      const { data: match } = await supabase
        .from("matches")
        .select("id")
        .eq("room_id", this.roomId)
        .eq("status", "ACTIVE")
        .single();

      if (!match) return;

      const { data: round } = await supabase
        .from("match_rounds")
        .select("id")
        .eq("match_id", match.id)
        .order("round_number", { ascending: false })
        .limit(1)
        .single();

      if (round) {
        await supabase
          .from("match_rounds")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", round.id);
      }
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Action: Buzzer claim (concurrency-safe via database atomic lock function RPC)
   */
   public async buzz(roundId: string, bid: number = 0): Promise<boolean> {
    try {
      const { data: success, error } = await supabase.rpc("claim_buzzer", {
        p_round_id: roundId,
        p_user_id: this.userId,
        p_bid: bid
      });

      if (error) {
        console.error("[GameSync] Claim buzzer RPC error:", error);
        return false;
      }

      return !!success;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  /**
   * Action: Submit answer (inserts answer to DB; DB trigger secure evaluates correctness)
   */
  public async submitAnswer(roundId: string, answer: any, timeSpentMs: number, powerUpsUsed: string[]) {
    try {
      // 1. Write round answer row (will trigger SQL PL/pgSQL secure grading)
      const { error } = await supabase.from("round_answers").insert({
        round_id: roundId,
        user_id: this.userId,
        answer: answer,
        time_spent_ms: timeSpentMs,
        power_ups_used: powerUpsUsed,
      });

      if (error) {
        console.error("[GameSync] Submit answer error:", error);
        return;
      }

      // 2. Fetch the graded result
      const { data: gradedAnswer, error: fetchError } = await supabase
        .from("round_answers")
        .select("is_correct, points_earned")
        .eq("round_id", roundId)
        .eq("user_id", this.userId)
        .single();

      if (fetchError || !gradedAnswer) {
        console.error("[GameSync] Fetch graded result error:", fetchError);
        return;
      }

      // 3. Update score locally in room_participants so it replicates
      const oldParticipant = this.activeParticipants.find(p => p.userId === this.userId);
      const oldScore = oldParticipant ? oldParticipant.score : 0;
      const newScore = Math.max(0, oldScore + gradedAnswer.points_earned);

      await supabase
        .from("room_participants")
        .update({ score: newScore })
        .eq("room_id", this.roomId)
        .eq("user_id", this.userId);

      // 4. If host, check if all active players have submitted.
      // If yes, end round immediately to speed up gameplay without waiting for timer!
      if (this.isHost) {
        await this.checkAndEndRoundIfAllSubmitted(roundId);
      }
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Host action: Check if all non-spectator players submitted and end round early
   */
  public async checkAndEndRoundIfAllSubmitted(roundId: string) {
    const { data: answers } = await supabase
      .from("round_answers")
      .select("user_id")
      .eq("round_id", roundId);

    const activePlayers = this.activeParticipants.filter(p => !p.isSpectator);
    
    // Check if buzzer mode: if buzzed, only wait for the buzzed player
    const { data: round } = await supabase
      .from("match_rounds")
      .select("buzzed_player_id")
      .eq("id", roundId)
      .single();

    const isBuzzedMode = round && round.buzzed_player_id !== null;
    
    let allSubmitted = false;
    if (isBuzzedMode) {
      allSubmitted = answers?.some(a => a.user_id === round.buzzed_player_id) || false;
    } else {
      allSubmitted = activePlayers.every(p => answers?.some(a => a.user_id === p.userId));
    }

    if (allSubmitted) {
      await supabase
        .from("match_rounds")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", roundId);
    }
  }

  /**
   * Action: Use Power-Up (broadcasts instantly to target/opponents)
   */
  public broadcastPowerUp(powerUpType: string, targetUserId?: string) {
    if (this.channel) {
      this.channel.send({
        type: "broadcast",
        event: "power_up_triggered",
        payload: {
          userId: this.userId,
          powerUpType,
          targetUserId,
        },
      });
    }
  }

  /**
   * Action: Chat Message Broadcast
   */
  public sendChatMessage(message: string, teamId: string | null = null) {
    if (this.channel) {
      this.channel.send({
        type: "broadcast",
        event: "chat_message",
        payload: {
          userId: this.userId,
          username: this.username,
          message,
          teamId,
        },
      });
    }
  }
}

// Utility helper
function coalesce<T>(value: T | undefined | null, defaultValue: T): T {
  return value !== undefined && value !== null ? value : defaultValue;
}
