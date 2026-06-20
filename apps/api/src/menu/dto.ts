import { IsBoolean } from 'class-validator';

export class Toggle86Dto {
  @IsBoolean()
  is86!: boolean;
}
