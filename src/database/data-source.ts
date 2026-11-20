import { DataSource } from 'typeorm';
import { createDataSourceOptions } from '../database.config';

// Data source del CLI de TypeORM (migration:run, migration:revert y
// migration:show). Usa las mismas variables DB_* que la aplicación.
export default new DataSource(createDataSourceOptions());
