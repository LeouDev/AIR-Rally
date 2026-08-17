"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClubAction } from "@/lib/actions/clubs";
import { CLUB_SKILL_LEVELS, CLUB_TYPES, CLUB_VISIBILITIES, type CreateClubValues } from "@/lib/validations/club";
import { createClient } from "@/lib/supabase/client";
import { uploadClubImage, ALLOWED_CLUB_IMAGE_TYPES } from "@/lib/services/clubImages";

const SKILL_LABELS: Record<(typeof CLUB_SKILL_LEVELS)[number], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  mixed: "All levels",
};

const TYPE_LABELS: Record<(typeof CLUB_TYPES)[number], string> = {
  social: "Social",
  competitive: "Competitive",
  training: "Training",
  casual: "Casual",
};

const VISIBILITY_LABELS: Record<(typeof CLUB_VISIBILITIES)[number], string> = {
  public: "Public — anyone can join instantly",
  approval_required: "Approval required — you review each request",
  private: "Private — invite only",
};

export function CreateClubForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<CreateClubValues>({
    name: "",
    description: "",
    location: "",
    skillLevel: "mixed",
    clubType: "social",
    visibility: "public",
  });

  function set<K extends keyof CreateClubValues>(key: K, value: CreateClubValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function pickImage(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    // Held locally until submit, so abandoning the form never leaves an
    // orphaned object in storage — same posture as the post composer.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    let imageUrl: string | undefined;
    if (imageFile) {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setSubmitting(false);
        toast.error("Sign in to create a club.");
        return;
      }
      const upload = await uploadClubImage(supabase, user.id, imageFile);
      if (upload.error || !upload.path) {
        setSubmitting(false);
        toast.error(upload.error ?? "Upload failed.");
        return;
      }
      imageUrl = upload.path;
    }

    const result = await createClubAction({
      ...values,
      description: values.description?.trim() || undefined,
      location: values.location?.trim() || undefined,
      imageUrl,
    });

    if (!result.success) {
      setSubmitting(false);
      toast.error(result.error);
      return;
    }

    toast.success("Your club is live.");
    router.push(`/clubs/${result.data.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="club-name">Club name</Label>
        <Input
          id="club-name"
          value={values.name}
          maxLength={80}
          required
          placeholder="Cebu Weekend Picklers"
          onChange={(e) => set("name", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-description">Description</Label>
        <textarea
          id="club-description"
          value={values.description ?? ""}
          maxLength={2000}
          rows={4}
          placeholder="Who you are, when you play, and who should join."
          onChange={(e) => set("description", e.target.value)}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-location">Location</Label>
        <Input
          id="club-location"
          value={values.location ?? ""}
          maxLength={200}
          placeholder="Cebu City"
          onChange={(e) => set("location", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="club-skill">Skill level</Label>
          <Select value={values.skillLevel} onValueChange={(v) => set("skillLevel", v as CreateClubValues["skillLevel"])}>
            <SelectTrigger id="club-skill" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_SKILL_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {SKILL_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="club-type">Club type</Label>
          <Select value={values.clubType} onValueChange={(v) => set("clubType", v as CreateClubValues["clubType"])}>
            <SelectTrigger id="club-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLUB_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-visibility">Who can join</Label>
        <Select value={values.visibility} onValueChange={(v) => set("visibility", v as CreateClubValues["visibility"])}>
          <SelectTrigger id="club-visibility" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLUB_VISIBILITIES.map((visibility) => (
              <SelectItem key={visibility} value={visibility}>
                {VISIBILITY_LABELS[visibility]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="club-photo">Club photo (optional)</Label>
        {previewUrl ? (
          <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-border">
            {/* Object URL, not a remote host — next/image would need the
                Supabase storage host in next.config's allowlist. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-40 w-full object-cover" />
            <button
              type="button"
              onClick={clearImage}
              aria-label="Remove photo"
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-24 w-full max-w-sm flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <ImageIcon className="size-5" aria-hidden="true" />
            Add a photo
          </button>
        )}
        <input
          id="club-photo"
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_CLUB_IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => pickImage(e.target.files)}
        />
        <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 5 MB.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting || !values.name.trim()}>
          {submitting ? "Creating…" : "Create club"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Running a club doesn&apos;t list a venue or manage courts — it&apos;s just your community.
        </p>
      </div>
    </form>
  );
}
