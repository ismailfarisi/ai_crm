import type { SystemRoleSlug } from '../role-slugs';

/**
 * One slice of the permission catalog, owned by one feature area.
 *
 * Everything a feature needs to register — its permission constants, their
 * descriptions, where they sit in the role editor, and which system roles get
 * them — lives in a single object in a single file. `index.ts` composes the
 * slices; nothing else appends to a shared structure.
 *
 * Adding a feature area means writing one new file and three additive lines in
 * `index.ts`. That is the whole point: the old single-file catalog had every
 * feature editing the same three structures, which made merges between
 * concurrent branches a permissions-shaped hazard.
 */
export interface PermissionDomain<P extends string = string> {
  /** Stable key for the role editor section. */
  key: string;
  label: string;
  /** The constants themselves, e.g. `{ CONTACT_READ: 'contact:read' }`. */
  permissions: Record<string, P>;
  descriptions: Record<P, string>;
  /**
   * The ordered subset shown in the role editor. Deliberately separate from
   * `permissions` — some permissions are resolved internally and are not
   * offered as a checkbox (`contact:read_team` is the existing example).
   */
  groupPermissions: P[];
  /**
   * Which system roles receive which of this domain's permissions. `owner` is
   * never listed: it holds every permission, including ones added later.
   */
  grants: Partial<Record<SystemRoleSlug, P[]>>;
}

/** Narrows `typeof SOME_PERMISSIONS` to the union of its values. */
export type PermissionValues<T extends Record<string, string>> = T[keyof T];
