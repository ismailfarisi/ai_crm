import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedView } from './entities/saved-view.entity';
import { SavedViewsService } from './saved-views.service';
import { SavedViewsController } from './saved-views.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SavedView])],
  controllers: [SavedViewsController],
  providers: [SavedViewsService],
  exports: [SavedViewsService],
})
export class SavedViewsModule {}
