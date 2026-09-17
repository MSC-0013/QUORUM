export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
}

export class ProjectRepository {
  private readonly projects = new Map<string, ProjectRecord>();

  public create(params: { id?: string; name: string; description?: string }): ProjectRecord {
    const id = params.id ?? `proj-${Math.random().toString(36).substring(2, 9)}`;
    if (this.projects.has(id)) {
      throw new Error(`Project with ID ${id} already exists`);
    }

    const record: ProjectRecord = {
      id,
      name: params.name,
      description: params.description,
      createdAt: new Date().toISOString()
    };

    this.projects.set(id, Object.freeze(record));
    return record;
  }

  public get(id: string): ProjectRecord | undefined {
    return this.projects.get(id);
  }

  public list(): readonly ProjectRecord[] {
    return Array.from(this.projects.values());
  }

  public clear(): void {
    this.projects.clear();
  }
}
