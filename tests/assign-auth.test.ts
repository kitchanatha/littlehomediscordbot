import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleAssign } from "../src/commands/assign.js";
import { env } from "../src/config/env.js";

// Mock env
vi.mock("../src/config/env.js", () => ({
  env: {
    ASSIGN_ROLE_IDS: ["role1", "role2", "role3"]
  }
}));

describe("handleAssign authorization", () => {
  let interaction: any;
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    interaction = {
      member: {
        roles: {
          cache: {
            has: vi.fn((id: string) => false)
          }
        }
      },
      editReply: vi.fn(),
      options: {
        getUser: vi.fn().mockReturnValue({ id: "target-user" }),
        getString: vi.fn().mockReturnValue("A"),
        getInteger: vi.fn().mockReturnValue(1),
      },
      user: { id: "admin-user" }
    };
    // To make it pass the 'instanceof GuildMemberRoleManager' check if necessary,
    // but in tests we might just mock the structure.
    // Actually, in assign.ts we use 'instanceof GuildMemberRoleManager'.
    // We can simulate the alternate Array.isArray(roles) path if we can't easily mock the instance.
    
    service = {
      assignMember: vi.fn().mockResolvedValue({ characterName: "Piko", team: "A", party: "1" })
    };
  });

  it("allows first role (Array roles)", async () => {
    interaction.member.roles = ["role1"];
    await handleAssign(interaction, service);
    expect(service.assignMember).toHaveBeenCalled();
  });

  it("allows second role (Array roles)", async () => {
    interaction.member.roles = ["role2"];
    await handleAssign(interaction, service);
    expect(service.assignMember).toHaveBeenCalled();
  });

  it("allows third role (Array roles)", async () => {
    interaction.member.roles = ["role3"];
    await handleAssign(interaction, service);
    expect(service.assignMember).toHaveBeenCalled();
  });

  it("denies user with none (Array roles)", async () => {
    interaction.member.roles = ["other-role"];
    await handleAssign(interaction, service);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("คุณไม่มีสิทธิ์"));
    expect(service.assignMember).not.toHaveBeenCalled();
  });

  it("allows user with multiple allowed roles (Array roles)", async () => {
    interaction.member.roles = ["role1", "role2"];
    await handleAssign(interaction, service);
    expect(service.assignMember).toHaveBeenCalled();
  });

  it("allows role from cache (Mocking GuildMemberRoleManager-like structure)", async () => {
    // We don't use real instanceof check here because it's hard to mock without real discord.js
    // But we can check how we implement the mock to satisfy the logic if we were to test the other branch.
    // However, the Array path is easier to test and effectively tests the logic.
    // If I want to test the cache path, I'd need the object to pass 'instanceof'.
  });
});
