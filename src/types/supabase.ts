export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      daily_affirmations: {
        Row: {
          affirmation_text: string
          created_at: string
          entry_id: string
          headline: string
          id: string
          is_delivered: boolean
          is_favorite: boolean
          position: number
          scheduled_for: string | null
          time_slot: string | null
          user_id: string
          verse_reference: string | null
          verse_text: string | null
        }
        Insert: {
          affirmation_text: string
          created_at?: string
          entry_id: string
          headline: string
          id?: string
          is_delivered?: boolean
          is_favorite?: boolean
          position: number
          scheduled_for?: string | null
          time_slot?: string | null
          user_id: string
          verse_reference?: string | null
          verse_text?: string | null
        }
        Update: {
          affirmation_text?: string
          created_at?: string
          entry_id?: string
          headline?: string
          id?: string
          is_delivered?: boolean
          is_favorite?: boolean
          position?: number
          scheduled_for?: string | null
          time_slot?: string | null
          user_id?: string
          verse_reference?: string | null
          verse_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_affirmations_entry_user_fkey"
            columns: ["entry_id", "user_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "daily_affirmations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_devotionals: {
        Row: {
          deleted_at: string
          entry_id: string
          made_at: string
          user_id: string
        }
        Insert: {
          deleted_at?: string
          entry_id: string
          made_at: string
          user_id: string
        }
        Update: {
          deleted_at?: string
          entry_id?: string
          made_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deleted_devotionals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          answered_at: string | null
          answered_notes: string | null
          audio_path: string | null
          client_entry_id: string | null
          closing_prayer: string | null
          created_at: string
          devotional_audio_path: string | null
          devotional_duration_ms: number | null
          devotional_script: string | null
          devotional_title: string | null
          dominant_emotion: string | null
          error_code: string | null
          help_line: string | null
          id: string
          input_type: string
          is_active_prayer: boolean
          is_answered: boolean
          is_crisis: boolean
          prayer_category: string | null
          prayer_summary: string | null
          prayer_title: string | null
          processing_status: string
          scripture_reference: string | null
          scripture_text: string | null
          scripture_verified: boolean
          transcript: string | null
          updated_at: string
          user_id: string
          validation_line: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_notes?: string | null
          audio_path?: string | null
          client_entry_id?: string | null
          closing_prayer?: string | null
          created_at?: string
          devotional_audio_path?: string | null
          devotional_duration_ms?: number | null
          devotional_script?: string | null
          devotional_title?: string | null
          dominant_emotion?: string | null
          error_code?: string | null
          help_line?: string | null
          id?: string
          input_type: string
          is_active_prayer?: boolean
          is_answered?: boolean
          is_crisis?: boolean
          prayer_category?: string | null
          prayer_summary?: string | null
          prayer_title?: string | null
          processing_status?: string
          scripture_reference?: string | null
          scripture_text?: string | null
          scripture_verified?: boolean
          transcript?: string | null
          updated_at?: string
          user_id: string
          validation_line?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_notes?: string | null
          audio_path?: string | null
          client_entry_id?: string | null
          closing_prayer?: string | null
          created_at?: string
          devotional_audio_path?: string | null
          devotional_duration_ms?: number | null
          devotional_script?: string | null
          devotional_title?: string | null
          dominant_emotion?: string | null
          error_code?: string | null
          help_line?: string | null
          id?: string
          input_type?: string
          is_active_prayer?: boolean
          is_answered?: boolean
          is_crisis?: boolean
          prayer_category?: string | null
          prayer_summary?: string | null
          prayer_title?: string | null
          processing_status?: string
          scripture_reference?: string | null
          scripture_text?: string | null
          scripture_verified?: boolean
          transcript?: string | null
          updated_at?: string
          user_id?: string
          validation_line?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      scholar_conversations: {
        Row: {
          created_at: string
          entry_id: string | null
          id: string
          is_heavy: boolean
          last_message_at: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_id?: string | null
          id: string
          is_heavy?: boolean
          last_message_at?: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string | null
          id?: string
          is_heavy?: boolean
          last_message_at?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scholar_conversations_entry_user_fkey"
            columns: ["entry_id", "user_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "scholar_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      scholar_messages: {
        Row: {
          claimed_at: string | null
          content: Json | null
          conversation_id: string
          created_at: string
          error_code: string | null
          id: string
          input_type: string | null
          is_heavy: boolean
          reply_to: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          content?: Json | null
          conversation_id: string
          created_at?: string
          error_code?: string | null
          id: string
          input_type?: string | null
          is_heavy?: boolean
          reply_to?: string | null
          role: string
          status?: string
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          content?: Json | null
          conversation_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          input_type?: string | null
          is_heavy?: boolean
          reply_to?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scholar_messages_conversation_user_fkey"
            columns: ["conversation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "scholar_conversations"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "scholar_messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "scholar_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scholar_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      scholar_safety_daily: {
        Row: {
          day: string
          fallbacks: number
          flagged_blocked: number
          flagged_model: number
          flagged_phrase: number
          flagged_uncertain: number
          flagged_writer: number
          free_answered: number
          screen_failed: number
          screened: number
        }
        Insert: {
          day: string
          fallbacks?: number
          flagged_blocked?: number
          flagged_model?: number
          flagged_phrase?: number
          flagged_uncertain?: number
          flagged_writer?: number
          free_answered?: number
          screen_failed?: number
          screened?: number
        }
        Update: {
          day?: string
          fallbacks?: number
          flagged_blocked?: number
          flagged_model?: number
          flagged_phrase?: number
          flagged_uncertain?: number
          flagged_writer?: number
          free_answered?: number
          screen_failed?: number
          screened?: number
        }
        Relationships: []
      }
      scholar_usage: {
        Row: {
          day: string
          listens: number
          messages: number
          user_id: string
        }
        Insert: {
          day: string
          listens?: number
          messages?: number
          user_id: string
        }
        Update: {
          day?: string
          listens?: number
          messages?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scholar_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      users_profile: {
        Row: {
          affirmations_enabled: boolean
          ambient_sound: string
          ambient_volume: number
          created_at: string
          id: string
          last_active_at: string | null
          reminder_afternoon: string
          reminder_evening: string
          reminder_morning: string
          scholar_closed_at: string | null
          subscription_expires_at: string | null
          subscription_synced_at: string | null
          subscription_tier: string
          timezone: string
          updated_at: string
        }
        Insert: {
          affirmations_enabled?: boolean
          ambient_sound?: string
          ambient_volume?: number
          created_at?: string
          id: string
          last_active_at?: string | null
          reminder_afternoon?: string
          reminder_evening?: string
          reminder_morning?: string
          scholar_closed_at?: string | null
          subscription_expires_at?: string | null
          subscription_synced_at?: string | null
          subscription_tier?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          affirmations_enabled?: boolean
          ambient_sound?: string
          ambient_volume?: number
          created_at?: string
          id?: string
          last_active_at?: string | null
          reminder_afternoon?: string
          reminder_evening?: string
          reminder_morning?: string
          scholar_closed_at?: string | null
          subscription_expires_at?: string | null
          subscription_synced_at?: string | null
          subscription_tier?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_scholar_safety: {
        Args: { p_counter: string; p_day: string }
        Returns: undefined
      }
      bump_scholar_usage: {
        Args: {
          p_day: string
          p_listens: number
          p_messages: number
          p_user: string
        }
        Returns: undefined
      }
      feature_affirmation: {
        Args: { p_affirmation: string; p_entry: string; p_slot: string }
        Returns: undefined
      }
      reflection_streak_days: { Args: { tz: string }; Returns: number }
      requesting_user_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
