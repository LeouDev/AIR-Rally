import { z } from "zod";
import { phoneRegex } from "@/lib/validations/shared";

// Deliberately no `.transform()` here — a transformed schema gives Zod a
// different input type than output type, which trips up react-hook-form's
// zodResolver (the form works with the input/pre-transform shape). Empty
// string -> null conversion happens in lib/services/profiles.ts instead,
// right before the values hit Supabase.
export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(80),
  lastName: z.string().trim().min(1, "Enter your last name").max(80),
  displayName: z.string().trim().min(1, "Enter a display name").max(80),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((value) => value === "" || phoneRegex.test(value), "Enter a valid phone number"),
  // Manual URL entry for now — see ARCHITECTURE.md on avatar upload being
  // deferred until Supabase Storage is wired up.
  avatarUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => value === "" || z.url().safeParse(value).success, "Enter a valid image URL"),
});
export type UpdateProfileValues = z.infer<typeof updateProfileSchema>;

// Separate from updateProfileSchema — persisted immediately after a
// Storage upload (see AvatarUploadButton.tsx), not as part of the rest of
// the profile form's fields.
export const updateAvatarSchema = z.object({
  avatarUrl: z.url().max(2048),
});
export type UpdateAvatarValues = z.infer<typeof updateAvatarSchema>;
