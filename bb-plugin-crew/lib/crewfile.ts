// `add member` / `remove member` (§3.3): change the crew file, then apply.
//
// The edit works on the YAML document rather than on a re-serialised object,
// so comments and the order the human chose survive. Pure: text in, text out;
// the caller validates and applies.
import YAML, { isMap, isSeq, type Document, type YAMLMap, type YAMLSeq } from "yaml";
import { memberKey, memberKeysOf, PERMISSIONS, type Permission } from "./spec";

export class CrewFileEditError extends Error {}

export type NewMember = {
  group: string;
  id: string;
  role?: string;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  serviceTier?: string;
  permissions?: Permission;
  kickoff?: string;
};

function parse(yaml: string): Document {
  const doc = YAML.parseDocument(yaml);
  if (doc.errors.length > 0) throw new CrewFileEditError(`The crew file is not valid YAML: ${doc.errors[0]!.message.split("\n")[0]}`);
  if (!isMap(doc.contents)) throw new CrewFileEditError("The crew file is not a mapping.");
  return doc;
}

function groupsOf(doc: Document): YAMLSeq {
  const groups = doc.get("groups", true);
  if (!isSeq(groups)) throw new CrewFileEditError("The crew file has no groups list.");
  return groups;
}

const idOf = (node: unknown) => (isMap(node) ? String((node as YAMLMap).get("id") ?? "") : "");

function leadOf(groups: ReturnType<typeof groupsOf>): YAMLMap | null {
  for (const group of groups.items) {
    if (!isMap(group)) continue;
    const members = (group as YAMLMap).get("members", true);
    if (!isSeq(members)) continue;
    for (const member of members.items) if (isMap(member) && (member as YAMLMap).get("lead") === true) return member as YAMLMap;
  }
  return null;
}

/** The member id without a leading "<group>-": a lead that passes "steps-impl3" for group steps means "impl3" (BBP-248). */
export function memberIdIn(group: string, id: string): string {
  return id.startsWith(`${group}-`) && id.length > group.length + 1 ? id.slice(group.length + 1) : id;
}

export function addMemberToFile(yaml: string, input: NewMember): string {
  const doc = parse(yaml);
  const member = { ...input, id: memberIdIn(input.group, input.id) };
  if (!/^[A-Za-z0-9][\w-]*$/.test(member.group) || !/^[A-Za-z0-9][\w-]*$/.test(member.id)) {
    throw new CrewFileEditError("Group and member ids are letters, digits, '-' and '_' only.");
  }
  if (member.permissions !== undefined && !PERMISSIONS.includes(member.permissions)) {
    throw new CrewFileEditError(`permissions must be one of ${PERMISSIONS.join(", ")}.`);
  }
  const groups = groupsOf(doc);
  let group = groups.items.find((node) => idOf(node) === member.group) as YAMLMap | undefined;
  if (!group) {
    group = doc.createNode({ id: member.group, members: [] }) as YAMLMap;
    groups.add(group);
  }
  const members = group.get("members", true);
  if (!isSeq(members)) throw new CrewFileEditError(`Group ${member.group} has no members list.`);
  const mode = memberKeysOf(doc.get("memberKeys"));
  const key = memberKey(mode, member.group, member.id);
  const taken = groups.items.some((g) => {
    const list = isMap(g) ? (g as YAMLMap).get("members", true) : null;
    return isSeq(list) && list.items.some((node) => memberKey(mode, idOf(g), idOf(node)) === key);
  });
  if (taken) throw new CrewFileEditError(`${key} is already in the crew file.`);
  const entry: Record<string, unknown> = { id: member.id };
  for (const key of ["provider", "model", "reasoningLevel", "serviceTier", "permissions", "role", "kickoff"] as const) {
    const value = member[key];
    if (value !== undefined && value !== "") entry[key] = value;
  }
  // Members carry their own provider and model. Whatever the caller left out
  // is copied from the first member of the same group (from the lead when the
  // group is new) and written out, so the new member stands alone.
  const sibling = members.items.find(isMap) as YAMLMap | undefined;
  const source = sibling ?? leadOf(groups);
  for (const key of ["provider", "model"] as const) {
    if (entry[key] === undefined && source?.get(key) !== undefined) entry[key] = source.get(key);
  }
  members.add(doc.createNode(entry));
  return doc.toString({ lineWidth: 0 });
}

/** Removes the member, links that name it, and its group when it becomes empty. The lead cannot be removed. */
export function removeMemberFromFile(yaml: string, key: string): string {
  const doc = parse(yaml);
  const groups = groupsOf(doc);
  const mode = memberKeysOf(doc.get("memberKeys"));
  let found = false;
  for (const node of [...groups.items]) {
    if (!isMap(node)) continue;
    const group = node as YAMLMap;
    const members = group.get("members", true);
    if (!isSeq(members)) continue;
    for (const candidate of [...members.items]) {
      if (!isMap(candidate) || memberKey(mode, idOf(group), idOf(candidate)) !== key) continue;
      if ((candidate as YAMLMap).get("lead") === true) {
        throw new CrewFileEditError(`${key} is the lead; make another member lead first.`);
      }
      members.items.splice(members.items.indexOf(candidate), 1);
      found = true;
    }
    if (found && members.items.length === 0) groups.items.splice(groups.items.indexOf(node), 1);
    if (found) break;
  }
  if (!found) throw new CrewFileEditError(`There is no member ${key} in the crew file.`);
  const links = doc.get("links", true);
  if (isSeq(links)) {
    links.items = links.items.filter((link) => !isMap(link) || (String((link as YAMLMap).get("from")) !== key && String((link as YAMLMap).get("to")) !== key));
  }
  // A deputy pointing at the removed member would fail validation.
  for (const node of groups.items) {
    const members = isMap(node) ? (node as YAMLMap).get("members", true) : null;
    if (!isSeq(members)) continue;
    for (const candidate of members.items) if (isMap(candidate) && (candidate as YAMLMap).get("deputy") === key) (candidate as YAMLMap).delete("deputy");
  }
  return doc.toString({ lineWidth: 0 });
}
