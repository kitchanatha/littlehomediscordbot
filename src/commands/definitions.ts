import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register your Ragnarok character")
    .addStringOption((o) => o.setName("character_name").setDescription("Your in-game character name").setRequired(true))
    .addStringOption((o) => o.setName("class").setDescription("Your class; optional if your legacy record is found")),
  new SlashCommandBuilder().setName("profile").setDescription("Show your guild profile"),
  new SlashCommandBuilder()
    .setName("name")
    .setDescription("Change your character name")
    .addStringOption((o) => o.setName("new_name").setDescription("Your new character name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("class")
    .setDescription("Change your class")
    .addStringOption((o) => o.setName("new_class").setDescription("Your new class").setRequired(true)),
  new SlashCommandBuilder().setName("history").setDescription("Show your name and class change history"),
].map((c) => c.toJSON());
