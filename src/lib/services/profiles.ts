import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/lib/supabase/types";
import type { UpdateProfileValues } from "@/lib/validations/profile";

type Client = SupabaseClient<Database>;

export async function getProfile(supabase: Client, userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  supabase: Client,
  userId: string,
  values: UpdateProfileValues
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      first_name: values.firstName,
      last_name: values.lastName,
      display_name: values.displayName,
      phone: values.phone || null,
      avatar_url: values.avatarUrl || null,
    })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
