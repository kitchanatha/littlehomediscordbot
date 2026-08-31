import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register your Ragnarok character")
    .addStringOption((o) => o.setName("name").setDescription("Your in-game character name").setRequired(true))
    .addStringOption((o) => o.setName("class").setDescription("Your class").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("profile").setDescription("Show your guild profile"),
  new SlashCommandBuilder()
    .setName("name")
    .setDescription("Change your character name")
    .addStringOption((o) => o.setName("new_name").setDescription("Your new character name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("class")
    .setDescription("Change your class")
    .addStringOption((o) => o.setName("new_class").setDescription("Your new class").setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("history").setDescription("Show your name and class change history"),
  new SlashCommandBuilder()
    .setName("assign")
    .setDescription("Assign a member to a team and party (Admin only)")
    .addUserOption((o) => o.setName("member").setDescription("The Discord user to assign").setRequired(true))
    .addStringOption((o) =>
      o.setName("team")
        .setDescription("The team (A, B, or C)")
        .setRequired(true)
        .addChoices({ name: "A", value: "A" }, { name: "B", value: "B" }, { name: "C", value: "C" })
    )
    .addIntegerOption((o) => o.setName("party").setDescription("The party number (1+)").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName("war_roster")
    .setDescription("Show the Sunday War roster")
    .addStringOption((o) =>
      o.setName("team")
        .setDescription("Filter by team (A, B, or C)")
        .addChoices({ name: "A", value: "A" }, { name: "B", value: "B" }, { name: "C", value: "C" })
    )
    .addIntegerOption((o) => o.setName("party").setDescription("Filter by party number (1+)").setMinValue(1)),
  new SlashCommandBuilder()
    .setName("name_class")
    .setDescription("Update character name and/or class")
    .addUserOption((o) => o.setName("member").setDescription("Member to update (Admin only)"))
    .addStringOption((o) => o.setName("name").setDescription("New character name"))
    .addStringOption((o) => o.setName("class").setDescription("New class").setAutocomplete(true)),
  new SlashCommandBuilder()
    .setName("register_all")
    .setDescription("Register all server members as Pending (Admin only)")
    .addRoleOption((o) => o.setName("role").setDescription("Optional role filter")),
  new SlashCommandBuilder()
    .setName("queue_join")
    .setDescription("Join a queue")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Queue type")
        .setRequired(true)
        .addChoices({ name: "Card", value: "Card" }, { name: "Accessory", value: "Accessory" })
    ),
  new SlashCommandBuilder()
    .setName("queue_leave")
    .setDescription("Leave a queue")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Queue type")
        .setRequired(true)
        .addChoices({ name: "Card", value: "Card" }, { name: "Accessory", value: "Accessory" })
    ),
  new SlashCommandBuilder().setName("queue_status").setDescription("Show your queue status"),
  new SlashCommandBuilder()
    .setName("queue_list")
    .setDescription("Show current queue")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Queue type")
        .setRequired(true)
        .addChoices({ name: "Card", value: "Card" }, { name: "Accessory", value: "Accessory" })
    ),
  new SlashCommandBuilder()
    .setName("queue_add")
    .setDescription("Add a member to a queue (Admin only)")
    .addUserOption((o) => o.setName("member").setDescription("Member to add").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Queue type")
        .setRequired(true)
        .addChoices({ name: "Card", value: "Card" }, { name: "Accessory", value: "Accessory" })
    ),
  new SlashCommandBuilder()
    .setName("queue_remove")
    .setDescription("Remove a member from a queue (Admin only)")
    .addUserOption((o) => o.setName("member").setDescription("Member to remove").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Queue type")
        .setRequired(true)
        .addChoices({ name: "Card", value: "Card" }, { name: "Accessory", value: "Accessory" })
    ),
].map((c) => c.toJSON());
