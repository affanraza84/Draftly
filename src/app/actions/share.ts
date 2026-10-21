"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type RecipientLookupResult =
  | { success: true; user: { id: string; email: string } }
  | { success: false; error: string };

/**
 * Safely looks up a recipient by email without exposing the auth.users table
 * or allowing enumeration of all users.
 */
export async function lookupRecipientByEmail(
  rawEmail: string
): Promise<RecipientLookupResult> {
  const email = rawEmail.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user: currentUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !currentUser) {
    return { success: false, error: "You must be signed in to share documents." };
  }

  if (currentUser.email && currentUser.email.toLowerCase() === email) {
    return { success: false, error: "You cannot share a document with yourself." };
  }

  // Query the public profiles table for an exact email match
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    return { success: false, error: `Lookup failed: ${error.message}` };
  }

  if (!profile) {
    return {
      success: false,
      error: "No user found with that email address. Ensure the user has signed up first.",
    };
  }

  if (profile.id === currentUser.id) {
    return { success: false, error: "You cannot share a document with yourself." };
  }

  return {
    success: true,
    user: {
      id: profile.id,
      email: profile.email,
    },
  };
}
