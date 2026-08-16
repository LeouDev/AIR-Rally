"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Cropper, { type Area } from "react-easy-crop";
import { Camera, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/services/avatars";
import { updateAvatarAction } from "@/lib/actions/profile";
import { getCroppedImageBlob } from "@/lib/image-crop";

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
 *
 * Selecting a file doesn't upload it immediately: it opens a crop
 * dialog (react-easy-crop) first, so a photo that isn't already
 * perfectly square/centered can be repositioned before it becomes the
 * user's avatar everywhere. Only the cropped region is ever uploaded.
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  function resetCropState() {
    if (pendingImageUrl) URL.revokeObjectURL(pendingImageUrl);
    setPendingFile(null);
    setPendingImageUrl(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFileSelected(file: File | undefined) {
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setPendingFile(file);
    setPendingImageUrl(URL.createObjectURL(file));
  }

  async function handleSaveCrop() {
    if (!pendingFile || !pendingImageUrl || !croppedAreaPixels) return;

    setIsUploading(true);
    try {
      const croppedBlob = await getCroppedImageBlob(pendingImageUrl, croppedAreaPixels, pendingFile.type);
      const croppedFile = new File([croppedBlob], pendingFile.name, { type: pendingFile.type });

      const publicUrl = await uploadAvatar(supabase, userId, croppedFile);
      // Fixed storage path means the URL itself never changes on
      // re-upload — a cache-busting query param is what makes the new
      // image actually show up instead of a stale cached one.
      const result = await updateAvatarAction(`${publicUrl}?v=${Date.now()}`);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile photo updated");
      resetCropState();
      router.refresh();
    } catch {
      toast.error("We couldn't upload that photo. Please try again.");
    } finally {
      setIsUploading(false);
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
          onChange={(e) => handleFileSelected(e.target.files?.[0])}
        />
        <Camera className="size-4" aria-hidden="true" />
      </label>

      <Dialog open={pendingImageUrl !== null} onOpenChange={(open) => !open && resetCropState()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reposition your photo</DialogTitle>
          </DialogHeader>

          {pendingImageUrl && (
            <div className="relative h-72 w-full overflow-hidden rounded-lg bg-muted">
              <Cropper
                image={pendingImageUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary"
              aria-label="Zoom"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetCropState} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={handleSaveCrop} disabled={isUploading || !croppedAreaPixels}>
              {isUploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving…
                </>
              ) : (
                "Save photo"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
