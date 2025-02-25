import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Repository, SelectQueryBuilder } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "@supabase/supabase-js";

import { PullRequestGithubEventsService } from "../../timescale/pull_request_github_events.service";
import { DbUser } from "../user.entity";
import { UpdateUserDto } from "../dtos/update-user.dto";
import { UpdateUserProfileInterestsDto } from "../dtos/update-user-interests.dto";
import { UpdateUserEmailPreferencesDto } from "../dtos/update-user-email-prefs.dto";
import { UserOnboardingDto } from "../../auth/dtos/user-onboarding.dto";
import { userNotificationTypes } from "../entities/user-notification.constants";
import { DbUserHighlightReaction } from "../entities/user-highlight-reaction.entity";
import { DbTopUser } from "../entities/top-users.entity";
import { TopUsersDto } from "../dtos/top-users.dto";
import { PageDto } from "../../common/dtos/page.dto";
import { PageMetaDto } from "../../common/dtos/page-meta.dto";
import { DbFilteredUser } from "../entities/filtered-users.entity";
import { FilteredUsersDto } from "../dtos/filtered-users.dto";
import { DbUserHighlight } from "../entities/user-highlight.entity";
import { DbInsight } from "../../insight/entities/insight.entity";
import { DbUserCollaboration } from "../entities/user-collaboration.entity";
import { DbUserList } from "../../user-lists/entities/user-list.entity";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(DbUser, "ApiConnection")
    private userRepository: Repository<DbUser>,
    @InjectRepository(DbUserHighlightReaction, "ApiConnection")
    private userHighlightReactionRepository: Repository<DbUserHighlightReaction>,
    @InjectRepository(DbUserHighlight, "ApiConnection")
    private userHighlightRepository: Repository<DbUserHighlight>,
    @InjectRepository(DbInsight, "ApiConnection")
    private userInsightsRepository: Repository<DbInsight>,
    @InjectRepository(DbUserCollaboration, "ApiConnection")
    private userCollaborationRepository: Repository<DbUserCollaboration>,
    @InjectRepository(DbUserList, "ApiConnection")
    private userListRepository: Repository<DbUserList>,
    private pullRequestGithubEventsService: PullRequestGithubEventsService
  ) {}

  baseQueryBuilder(): SelectQueryBuilder<DbUser> {
    const builder = this.userRepository.createQueryBuilder("users");

    return builder;
  }

  reactionsQueryBuilder(): SelectQueryBuilder<DbUserHighlightReaction> {
    const builder = this.userHighlightReactionRepository.createQueryBuilder("user_highlight_reactions");

    return builder;
  }

  async findTopUsers(pageOptionsDto: TopUsersDto): Promise<PageDto<DbTopUser>> {
    const queryBuilder = this.reactionsQueryBuilder();

    const { userId } = pageOptionsDto;

    queryBuilder
      .select("users.login as login")
      .from(DbUser, "users")
      .innerJoin("user_highlights", "user_highlights", "user_highlights.user_id = users.id")
      .innerJoin("user_highlight_reactions", "reactions", "reactions.highlight_id = user_highlights.id")
      .where("reactions.deleted_at IS NULL");

    if (userId) {
      queryBuilder
        .andWhere(
          "users.id NOT IN (SELECT following_user_id FROM users_to_users_followers WHERE user_id = :userId AND deleted_at IS NULL)"
        )
        .setParameters({ userId });
    }

    queryBuilder.groupBy("users.login").orderBy("COUNT(reactions.user_id)", "DESC");

    queryBuilder.offset(pageOptionsDto.skip).limit(pageOptionsDto.limit);

    const [itemCount, entities] = await Promise.all([queryBuilder.getCount(), queryBuilder.getRawMany()]);
    const pageMetaDto = new PageMetaDto({ itemCount, pageOptionsDto });

    return new PageDto(entities, pageMetaDto);
  }

  async findOneById(id: number, includeEmail = false): Promise<DbUser> {
    const queryBuilder = this.baseQueryBuilder();

    queryBuilder
      .addSelect(
        `(
          SELECT COALESCE(COUNT("user_notifications"."id"), 0)
          FROM user_notifications
          WHERE user_id = :userId
          AND user_notifications.type IN (:...userNotificationTypes)
          AND user_notifications.read_at IS NULL
        )::INTEGER`,
        "users_notification_count"
      )
      .addSelect(
        `(
          SELECT COALESCE(COUNT("insights"."id"), 0)
          FROM insights
          LEFT JOIN insight_members ON insights.id = insight_members.insight_id
          WHERE insight_members.user_id = :userId
        )::INTEGER`,
        "users_insights_count"
      )
      .where("id = :id", { id });

    if (includeEmail) {
      queryBuilder.addSelect("users.email", "users_email");
    }

    let item: DbUser | null;

    try {
      queryBuilder.setParameters({ userId: id, userNotificationTypes });
      item = await queryBuilder.getOne();
    } catch (e) {
      // handle error
      item = null;
    }

    if (!item) {
      throw new NotFoundException();
    }

    return item;
  }

  async findOneByUsername(username: string): Promise<DbUser> {
    const recentPrCount = await this.pullRequestGithubEventsService.findCountByPrAuthor(username, 30, 0);
    const userVelocity = await this.pullRequestGithubEventsService.findVelocityByPrAuthor(username, 30, 0);

    const queryBuilder = this.baseQueryBuilder();

    queryBuilder
      .addSelect(
        `(
        SELECT COALESCE(COUNT("user_highlights"."id"), 0)
        FROM user_highlights
        WHERE user_id = users.id
        AND user_highlights.deleted_at IS NULL
      )::INTEGER`,
        "users_highlights_count"
      )
      .addSelect(
        `(
        SELECT COALESCE(COUNT("user_follows"."id"), 0)
        FROM users_to_users_followers user_follows
        WHERE user_id = users.id
        AND user_follows.deleted_at IS NULL
      )::INTEGER`,
        "users_following_count"
      )
      .addSelect(
        `(
        SELECT COALESCE(COUNT("user_follows"."id"), 0)
        FROM users_to_users_followers user_follows
        WHERE following_user_id = users.id
        AND user_follows.deleted_at IS NULL
      )::INTEGER`,
        "users_followers_count"
      )
      .addSelect(
        `(
          SELECT
            CASE
              WHEN COUNT(DISTINCT full_name) > 0 THEN true
              ELSE false
            END
          FROM pull_requests prs
          JOIN repos on prs.repo_id=repos.id
          WHERE LOWER(prs.merged_by_login) = :username
        )::BOOLEAN`,
        "users_is_maintainer"
      )
      .where("LOWER(login) = :username", { username: username.toLowerCase() })
      .setParameters({ username: username.toLowerCase() });

    const item: DbUser | null = await queryBuilder.getOne();

    if (!item) {
      throw new NotFoundException();
    }

    item.recent_pull_request_velocity_count = userVelocity;
    item.recent_pull_requests_count = recentPrCount;

    return item;
  }

  async findManyByUsernames(usernames: string[]): Promise<DbUser[]> {
    const queryBuilder = this.baseQueryBuilder();
    const lowerCaseUsernames = usernames.map((username) => username.toLowerCase());

    queryBuilder
      .where("LOWER(login) IN (:...usernames)", { usernames: lowerCaseUsernames })
      .setParameters({ usernames: lowerCaseUsernames });

    const items: DbUser[] = await queryBuilder.getMany();

    const foundUsernames = items.map((user) => user.login.toLowerCase());
    const notFoundUsernames = lowerCaseUsernames.filter((username) => !foundUsernames.includes(username));

    if (notFoundUsernames.length > 0) {
      throw new NotFoundException(notFoundUsernames);
    }

    return items;
  }

  async findUsersByFilter(pageOptionsDto: FilteredUsersDto): Promise<PageDto<DbFilteredUser>> {
    const queryBuilder = this.baseQueryBuilder();

    const { username, limit } = pageOptionsDto;

    if (!username) {
      throw new BadRequestException();
    }

    queryBuilder
      .select(["users.login as login", "users.name as full_name"])
      .where(`LOWER(users.login) LIKE :username`)
      .setParameters({ username: `%${username.toLowerCase()}%` })
      .limit(limit);

    queryBuilder.offset(pageOptionsDto.skip).limit(pageOptionsDto.limit);

    const [itemCount, entities] = await Promise.all([queryBuilder.getCount(), queryBuilder.getRawMany()]);
    const pageMetaDto = new PageMetaDto({ itemCount, pageOptionsDto });

    return new PageDto(entities, pageMetaDto);
  }

  async checkAddUser(user: User): Promise<DbUser> {
    const {
      user_metadata: { user_name, email, name },
      identities,
      confirmed_at,
    } = user;
    const github = identities!.filter((identity) => identity.provider === "github")[0];
    const id = parseInt(github.id, 10);

    try {
      const user = await this.findOneById(id, true);

      if (!user.is_open_sauced_member) {
        await this.userRepository.update(user.id, {
          is_open_sauced_member: true,
          connected_at: new Date(),
          campaign_start_date: new Date(),
        });
      }

      return user;
    } catch (e) {
      // create new user
      const newUser = await this.userRepository.save({
        id,
        name: name as string,
        is_open_sauced_member: true,
        login: user_name as string,
        email: email as string,
        created_at: new Date(github.created_at),
        updated_at: new Date(github.updated_at ?? github.created_at),
        connected_at: confirmed_at ? new Date(confirmed_at) : new Date(),
        campaign_start_date: confirmed_at ? new Date(confirmed_at) : new Date(),
      });

      return newUser;
    }
  }

  async updateUser(id: number, user: UpdateUserDto) {
    try {
      await this.findOneById(id);

      await this.userRepository.update(id, {
        name: user.name,
        email: user.email,
        bio: user.bio ?? "",
        url: user.url ?? "",
        twitter_username: user.twitter_username ?? "",
        company: user.company ?? "",
        location: user.location ?? "",
        display_local_time: !!user.display_local_time,
        timezone: user.timezone,
        github_sponsors_url: user.github_sponsors_url ?? "",
        linkedin_url: user.linkedin_url ?? "",
        discord_url: user.discord_url ?? "",
      });

      return this.findOneById(id);
    } catch (e) {
      throw new NotFoundException("Unable to update user");
    }
  }

  async updateOnboarding(id: number, user: UserOnboardingDto) {
    try {
      await this.findOneById(id);

      await this.userRepository.update(id, {
        is_onboarded: true,
        is_waitlisted: false,
        timezone: user.timezone,
        interests: user.interests.join(","),
      });
    } catch (e) {
      throw new NotFoundException("Unable to update user onboarding status");
    }
  }

  async updateWaitlistStatus(id: number) {
    try {
      await this.findOneById(id);

      await this.userRepository.update(id, { is_waitlisted: true });
    } catch (e) {
      throw new NotFoundException("Unable to update user waitlist status");
    }
  }

  async updateRole(id: number, role: number) {
    try {
      await this.findOneById(id);

      await this.userRepository.update(id, { role });
    } catch (e) {
      throw new NotFoundException("Unable to update user role");
    }
  }

  async updateInterests(id: number, user: UpdateUserProfileInterestsDto) {
    return this.userRepository.update(id, { interests: user.interests.join(",") });
  }

  async updateEmailPreferences(id: number, user: UpdateUserEmailPreferencesDto) {
    return this.userRepository.update(id, {
      display_email: user.display_email,
      receive_collaboration: user.receive_collaboration,
      receive_product_updates: user.receive_product_updates,
    });
  }

  async applyCoupon(id: number, coupon: string) {
    return this.userRepository.update(id, {
      coupon_code: coupon,
      role: 50,
    });
  }

  async findOneByEmail(email: string): Promise<DbUser | null> {
    const queryBuilder = this.baseQueryBuilder();

    queryBuilder.where(`users.email = :email`, { email: email.toLowerCase() });

    let item: DbUser | null;

    try {
      item = await queryBuilder.getOne();
    } catch (e) {
      // handle error
      item = null;
    }

    return item;
  }

  async deleteUser(id: number) {
    try {
      const user = await this.findOneById(id);

      /*
       * typeORM doesn't play well with soft deletes and foreign key constraints.
       * so, we capture all the users's relations and soft delete them manually
       * without disrupting the foreign key constraint back to the user
       */
      const userAndRelations = await this.userRepository.findOneOrFail({
        where: {
          id,
        },
        relations: [
          "highlights",
          "insights",
          "collaborations",
          "request_collaborations",
          "from_user_notifications",
          "lists",
        ],
      });

      await this.userRepository.softDelete(id);

      // need to reset these as we're only doing a soft delete.
      await this.userRepository.update(id, {
        is_onboarded: false,
        is_open_sauced_member: false,
      });

      await Promise.all([
        // soft delete the user's highlights
        Promise.all(
          userAndRelations.highlights.map(async (highlight) => {
            await this.userHighlightRepository.softDelete(highlight.id);
          })
        ),

        // soft delete the user's insight pages
        Promise.all(
          userAndRelations.insights.map(async (insight) => {
            await this.userInsightsRepository.softDelete(insight.id);
          })
        ),

        // soft delete the user's collaborations
        Promise.all(
          userAndRelations.collaborations.map(async (collab) => {
            await this.userCollaborationRepository.softDelete(collab.id);
          })
        ),
        // soft delete the user's collaboration requests
        Promise.all(
          userAndRelations.request_collaborations.map(async (req_collab) => {
            await this.userCollaborationRepository.softDelete(req_collab.id);
          })
        ),

        // soft delete the user's lists
        Promise.all(
          userAndRelations.lists.map(async (list) => {
            await this.userListRepository.softDelete(list.id);
          })
        ),
      ]);

      return user;
    } catch (e) {
      throw new NotFoundException("Unable to delete user");
    }
  }
}
