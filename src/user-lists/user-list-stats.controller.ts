import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  ApiOperation,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiBadRequestResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";

import { PageDto } from "../common/dtos/page.dto";

import { ApiPaginatedResponse } from "../common/decorators/api-paginated-response.decorator";
import { UserListMostActiveContributorsDto } from "./dtos/most-active-contributors.dto";
import { DbUserListContributorStat } from "./entities/user-list-contributor-stats.entity";
import { DbContributionStatTimeframe } from "./entities/contributions-timeframe.entity";
import { ContributionsTimeframeDto } from "./dtos/contributions-timeframe.dto";
import { DbContributionsProjects } from "./entities/contributions-projects.entity";
import { DbContributorCategoryTimeframe } from "./entities/contributors-timeframe.entity";
import { ContributionsByProjectDto } from "./dtos/contributions-by-project.dto";
import { TopProjectsDto } from "./dtos/top-projects.dto";
import { UserListEventsStatsService } from "./user-list-events-stats.service";

@Controller("lists")
@ApiTags("User Lists service")
export class UserListStatsController {
  constructor(private readonly userListEventsStatsService: UserListEventsStatsService) {}

  @Get(":id/stats/most-active-contributors")
  @ApiOperation({
    operationId: "getMostActiveContributorsV2",
    summary: "Gets most active contributors for a given list",
  })
  @ApiPaginatedResponse(DbUserListContributorStat)
  @ApiOkResponse({ type: DbUserListContributorStat })
  @ApiNotFoundResponse({ description: "Unable to get list most active contributors" })
  @ApiBadRequestResponse({ description: "Invalid request" })
  @ApiParam({ name: "id", type: "string" })
  async getMostActiveContributorsV2(
    @Param("id") id: string,
    @Query() pageOptionsDto: UserListMostActiveContributorsDto
  ): Promise<PageDto<DbUserListContributorStat>> {
    return this.userListEventsStatsService.findAllListContributorStats(pageOptionsDto, id);
  }

  @Get(":id/stats/contributions-evolution-by-type")
  @ApiOperation({
    operationId: "getContributionsByTimeFrame",
    summary: "Gets contributions in a given timeframe",
  })
  @ApiOkResponse({ type: DbContributionStatTimeframe })
  @ApiNotFoundResponse({ description: "Unable to get contributions" })
  @ApiBadRequestResponse({ description: "Invalid request" })
  @ApiParam({ name: "id", type: "string" })
  async getContributionsByTimeFrame(
    @Param("id") id: string,
    @Query() options: ContributionsTimeframeDto
  ): Promise<DbContributionStatTimeframe[]> {
    return this.userListEventsStatsService.findContributionsInTimeFrame(options, id);
  }

  @Get(":id/stats/contributions-by-project")
  @ApiOperation({
    operationId: "getContributionsByProject",
    summary: "Gets contributions in a given timeframe",
  })
  @ApiOkResponse({ type: DbContributionsProjects })
  @ApiNotFoundResponse({ description: "Unable to get contributions by project" })
  @ApiBadRequestResponse({ description: "Invalid request" })
  @ApiParam({ name: "id", type: "string" })
  @ApiQuery({ name: "range", type: "integer", required: false })
  async getContributionsByProject(
    @Param("id") id: string,
    @Query() options: ContributionsByProjectDto
  ): Promise<DbContributionsProjects[]> {
    return this.userListEventsStatsService.findContributionsByProject(options, id);
  }

  @Get(":id/stats/top-project-contributions-by-contributor/")
  @ApiOperation({
    operationId: "getContributorContributionsByProject",
    summary: "Gets top 20 contributor stats in a list by a given project",
  })
  @ApiOkResponse({ type: DbUserListContributorStat })
  @ApiNotFoundResponse({ description: "Unable to get contributions" })
  @ApiBadRequestResponse({ description: "Invalid request" })
  @ApiParam({ name: "id", type: "string" })
  async getContributorContributionsByProject(
    @Param("id") id: string,
    @Query() options: TopProjectsDto
  ): Promise<DbUserListContributorStat[]> {
    return this.userListEventsStatsService.findTopContributorsByProject(options, id);
  }

  @Get(":id/stats/contributions-evolution-by-contributor-type")
  @ApiOperation({
    operationId: "getContributorsByTimeframe",
    summary: "Gets contributions by category within timeframe",
  })
  @ApiOkResponse({ type: DbContributorCategoryTimeframe })
  @ApiNotFoundResponse({ description: "Unable to get contributions" })
  @ApiBadRequestResponse({ description: "Invalid request" })
  @ApiParam({ name: "id", type: "string" })
  async getContributionsByTimeframe(
    @Param("id") id: string,
    @Query() options: ContributionsTimeframeDto
  ): Promise<DbContributorCategoryTimeframe[]> {
    return this.userListEventsStatsService.findContributorCategoriesByTimeframe(options, id);
  }
}
