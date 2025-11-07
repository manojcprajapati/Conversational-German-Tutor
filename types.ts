export enum Role {
  USER = 'user',
  MODEL = 'model',
  ERROR = 'error',
}

export interface Message {
  role: Role;
  text: string;
}
