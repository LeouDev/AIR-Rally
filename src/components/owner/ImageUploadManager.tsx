"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { ImagePlus, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { uploadCourtImage, getPublicImageUrl } from "@/lib/services/images";
import { deleteImageAction } from "@/lib/actions/image";
import { PhotoLightbox } from "@/components/shared/PhotoLightbox";
import type { CourtImage } from "@/lib/supabase/types";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB — matches the bucket's own limit (defense-in-depth, see the migration)
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

/**
 * Uploads go directly from this client component to Supabase Storage (not
 * through a Server Action) — RLS on both `storage.objects` and
 * `court_images` already fully gates these writes to the venue's owner
 * (see supabase/migrations/20260809000005_court_images.sql and
 * 20260809000009_venue_images_storage.sql), so there's no security
 * benefit to proxying binary data through the app server, only bandwidth
 * cost. Deletion stays a Server Action (see lib/actions/image.ts) since
 * it needs to remove the DB row and the Storage object together and has
 * no bandwidth concern.
 */
export function ImageUploadManager({
  venueId,
  courtId,
  images,
}: {
  venueId: string;
  courtId: string | null;
  images: CourtImage[];
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();

  const lightboxImages = images.map((image) => ({
    url: getPublicImageUrl(supabase, image.storage_path),
    alt: image.alt_text ?? "",
  }));

  function validateFile(file: File): string | null {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return `${file.name}: only JPEG, PNG, or WEBP photos are allowed.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `${file.name}: photos must be 5MB or smaller.`;
    }
    return null;
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    const errors: string[] = [];
    const validFiles: File[] = [];
    for (const file of files) {
      const error = validateFile(file);
      if (error) errors.push(error);
      else validFiles.push(file);
    }
    errors.forEach((message) => toast.error(message));
    if (validFiles.length === 0) return;

    setIsUploading(true);
    let nextSortOrder = images.length;
    let uploadedCount = 0;
    try {
      for (const file of validFiles) {
        await uploadCourtImage(supabase, { venueId, courtId, file, sortOrder: nextSortOrder });
        nextSortOrder += 1;
        uploadedCount += 1;
      }
    } catch {
      toast.error(
        uploadedCount > 0
          ? `Uploaded ${uploadedCount} of ${validFiles.length} photos — one failed. Please try again for the rest.`
          : "We couldn't upload that photo. Please try again."
      );
    } finally {
      setIsUploading(false);
      if (uploadedCount > 0) {
        toast.success(uploadedCount === 1 ? "Photo uploaded" : `${uploadedCount} photos uploaded`);
        router.refresh();
      }
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDelete(imageId: string, isCover: boolean) {
    // Deleting removes the Storage object as well as the row, so there is
    // nothing to undo afterwards — hence a confirm rather than an undo
    // toast. The cover case is called out because losing it silently
    // changes how the venue looks on the marketplace.
    const message = isCover
      ? "Remove this photo? It's your cover image on the marketplace — the next photo will take its place. This can't be undone."
      : "Remove this photo? This can't be undone.";
    if (!window.confirm(message)) return;

    setDeletingId(imageId);
    startDeleteTransition(async () => {
      const result = await deleteImageAction(imageId, venueId);
      setDeletingId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Photo removed");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <div key={image.id} className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted">
              <button
                type="button"
                aria-label={`View photo ${index + 1}`}
                onClick={() => {
                  setLightboxIndex(index);
                  setLightboxOpen(true);
                }}
                className="absolute inset-0"
              >
                <Image
                  src={getPublicImageUrl(supabase, image.storage_path)}
                  alt={image.alt_text ?? ""}
                  fill
                  sizes="(min-width: 1024px) 200px, 33vw"
                  className="object-cover"
                />
              </button>
              {index === 0 && (
                <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium text-foreground">
                  Cover
                </span>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                disabled={isDeletePending && deletingId === image.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(image.id, index === 0);
                }}
                // Always visible, not hover-revealed. It used to be
                // opacity-0 until group-hover, which meant that on any
                // touch device — where there is no hover — removing a
                // photo was simply impossible, and on desktop it was
                // invisible until you happened to sweep over the tile.
                className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full border border-border bg-background/95 text-destructive shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-60"
              >
                {isDeletePending && deletingId === image.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors hover:border-primary/40",
          isUploading && "pointer-events-none opacity-60"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_ACCEPT_ATTR}
          className="hidden"
          disabled={isUploading}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {isUploading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <ImagePlus className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="text-sm font-medium text-foreground">
          {isUploading ? "Uploading…" : "Click to upload photos"}
        </span>
        <span className="text-xs text-muted-foreground">JPEG, PNG, or WEBP — up to 5MB each</span>
      </label>

      <PhotoLightbox
        images={lightboxImages}
        activeIndex={lightboxIndex}
        onIndexChange={setLightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        title="Venue photos"
      />
    </div>
  );
}
