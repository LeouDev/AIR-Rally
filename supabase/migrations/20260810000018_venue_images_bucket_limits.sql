-- Defense-in-depth for the venue-images bucket: RLS on storage.objects
-- (20260809000009_venue_images_storage.sql) already governs *who* can
-- write; this adds *what* they can write, so a client that skips its own
-- pre-upload validation still can't push an oversized or non-image file
-- past Storage's own API, not just past the app's UI. Matches the app's
-- own client-side limit (see src/components/owner/ImageUploadManager.tsx).
update storage.buckets
set file_size_limit = 5242880, -- 5 MiB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'venue-images';
