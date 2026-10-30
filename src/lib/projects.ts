// Projects: folders that keep takes, sequences and films together.

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Filter value for "takes in no project". */
export const UNSORTED = "unsorted";
