export interface Section {
  id: string;
  name: string;
  gmailLabel: string | null; // null = primary inbox (in:inbox)
}
