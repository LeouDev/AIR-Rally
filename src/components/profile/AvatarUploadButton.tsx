"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/services/avatars";
import { updateAvatarAction } from "@/lib/actions/profile";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // matches the avatars bucket's own limit — see the migration
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Only JPEG, PNG, or WEBP photos are allowed.";
  if (file.size > MAX_FILE_SIZE_BYTES) return "Photos must be 5MB or smaller.";
  return null;
}

/**
 * Uploads go straight from this client component to Supabase Storage —
 * same reasoning as ImageUploadManager.tsx (RLS already fully gates the
 * write to the caller's own folder, no bandwidth benefit to proxying
 * through the server) — then a Server Action persists the resulting URL
 * onto `profiles.avatar_url` (Storage alone doesn't touch that table).
 */
export function AvatarUploadButton({
  userId,
  currentAvatarUrl,
  displayName,
}: {
  userId: string;
  currentAvatarUrl: string | null;
  displayName: string;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setIsUploading(true);
    try {
      const publicUrl = await uploadAvatar(supabase, userId, file);
      // Fixed storage path means the URL itself never changes on
      // re-upload — a cache-busting query param is what makes the new
      // image actually show up instead of a stale cached one.
      const result = await updateAvatarAction(`${publicUrl}?v=${Date.now()}`);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile photo updated");
      router.refresh();
    } catch {
      toast.error("We couldn't upload that photo. Please try again.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="relative w-fit">
      <Avatar className="size-24">
        {currentAvatarUrl && <AvatarImage src={currentAvatarUrl} alt="" />}
        <AvatarFallback className="bg-secondary text-2xl font-semibold text-secondary-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>
      <label
        aria-label="Change profile photo"
        className="absolute right-0 bottom-0 flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-foreground text-background shadow-sm transition-opacity hover:opacity-90"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          disabled={isUploading}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {isUploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
      </label>
    </div>
  );
}
