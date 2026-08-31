export interface ClassConfig {
  classId: string;
  className: string;
  active: boolean;
  sortOrder: number;
  symbol: string;
  colorHex: string;
}

export interface ClassPresentation {
  className: string;
  symbol: string;
  colorHex: string;
}

export interface PlayerDisplay {
  text: string;
  className: string;
  symbol: string;
  colorHex: string | null;
}
