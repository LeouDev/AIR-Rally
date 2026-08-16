"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUploadManager } from "@/components/owner/ImageUploadManager";
import { createCourtAction, updateCourtAction } from "@/lib/actions/court";
import { createCourtSchema, type CreateCourtValues } from "@/lib/validations/court";
import type { Court, CourtImage } from "@/lib/supabase/types";

type CourtFormDialogProps =
  | { venueId: string; mode: "create"; trigger: ReactNode }
  | { venueId: string; mode: "edit"; court: Court; images: CourtImage[]; trigger: ReactNode };

const COURT_STATUS_OPTIONS: { value: Court["status"]; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "maintenance", label: "Maintenance" },
];

export function CourtFormDialog(props: CourtFormDialogProps) {
  const [open, setOpen] = useState(false);
  const isEdit = props.mode === "edit";
  const [status, setStatus] = useState<Court["status"]>(isEdit ? props.court.status : "active");
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCourtValues>({
    resolver: zodResolver(createCourtSchema),
    defaultValues: isEdit
      ? {
          name: props.court.name,
          description: props.court.description ?? "",
          surfaceType: props.court.surface_type ?? "",
          indoorOutdoor: props.court.indoor_outdoor,
          capacity: props.court.capacity ?? undefined,
          hourlyPrice: props.court.hourly_price,
        }
      : { indoorOutdoor: "outdoor", hourlyPrice: 0 },
  });

  async function onSubmit(values: CreateCourtValues) {
    const result = isEdit
      ? await updateCourtAction(props.venueId, props.court.id, { ...values, status })
      : await createCourtAction(props.venueId, values);

    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }

    toast.success(isEdit ? "Court updated" : "Court added");
    setOpen(false);
    if (!isEdit) reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Court" : "Add a Court"}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="court-name">Court name</Label>
            <Input id="court-name" placeholder="Court 1" aria-invalid={!!errors.name} {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="court-surface">Surface type (optional)</Label>
            <Input id="court-surface" placeholder="Cushioned Acrylic" {...register("surfaceType")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="court-indoorOutdoor">Indoor / Outdoor</Label>
              <Select
                value={watch("indoorOutdoor")}
                onValueChange={(value) => setValue("indoorOutdoor", value as CreateCourtValues["indoorOutdoor"], { shouldDirty: true })}
              >
                <SelectTrigger id="court-indoorOutdoor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="indoor">Indoor</SelectItem>
                  <SelectItem value="outdoor">Outdoor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="court-price">Hourly price (₱)</Label>
              <Input
                id="court-price"
                type="number"
                min={0}
                step="0.01"
                aria-invalid={!!errors.hourlyPrice}
                {...register("hourlyPrice", { valueAsNumber: true })}
              />
              {errors.hourlyPrice && <p className="text-xs text-destructive">{errors.hourlyPrice.message}</p>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="court-capacity">Capacity (optional)</Label>
            <Input
              id="court-capacity"
              type="number"
              min={1}
              max={20}
              aria-invalid={!!errors.capacity}
              {...register("capacity", {
                setValueAs: (value) => (value === "" ? undefined : Number(value)),
              })}
            />
            {errors.capacity && <p className="text-xs text-destructive">{errors.capacity.message}</p>}
          </div>

          {isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="court-status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as Court["status"])}>
                <SelectTrigger id="court-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COURT_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only active courts are shown to players.</p>
            </div>
          )}

          {isEdit && (
            <div className="flex flex-col gap-1.5">
              <Label>Court photos</Label>
              <ImageUploadManager venueId={props.venueId} courtId={props.court.id} images={props.images} />
            </div>
          )}

          {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : isEdit ? "Save Changes" : "Add Court"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
