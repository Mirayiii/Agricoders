import type { Profile, ProfileRole } from "@/types/auth";

/**
 * Role preview (Phase 9): an administrator can see the app's menus and screens
 * as another role sees them. It is a UI preview only. It lives in memory on this
 * device, never reaches the server, and never changes the real role, the
 * permissions the server checks, or the data it returns.
 */
export type RolePreview = { userId: string; role: ProfileRole };

/** Only an active administrator can preview, and only their own session. */
export function canPreviewRoles(profile: Profile | null): boolean {
  return profile?.role === "administrator" && profile.status === "active";
}

/** The role being previewed, or null when there is no valid preview. */
export function activePreviewRole(profile: Profile | null, preview: RolePreview | null): ProfileRole | null {
  if (!preview || !profile || !canPreviewRoles(profile) || preview.userId !== profile.id) return null;
  return preview.role === profile.role ? null : preview.role;
}

/** The profile screens use: the real one, with only the role swapped during a preview. */
export function previewedProfile(profile: Profile | null, preview: RolePreview | null): Profile | null {
  const role = activePreviewRole(profile, preview);
  return role && profile ? { ...profile, role } : profile;
}
