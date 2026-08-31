import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { WarRosterService } from "../services/war-roster-service.js";

export async function handleWarRoster(interaction: ChatInputCommandInteraction, service: WarRosterService) {
  const isRegistered = await service.isUserRegistered(interaction.user.id);
  if (!isRegistered) {
    await interaction.editReply({ content: "❌ Discord user นี้ยังไม่ได้ลงทะเบียน" });
    return;
  }

  const team = interaction.options.getString("team");
  const party = interaction.options.getInteger("party");

  if (party && !team) {
    await interaction.editReply({ content: "❌ กรุณาระบุ Team หากต้องการระบุ Party" });
    return;
  }

  const roster = await service.getRoster({ team: team || undefined, party: party || undefined });

  if (roster.teams.length === 0) {
    const msg = team && party 
      ? `ℹ️ No members found in Team ${team.toUpperCase()} / Party ${party}.`
      : team
      ? `ℹ️ No members found in Team ${team.toUpperCase()}.`
      : "ℹ️ No active War roster members found.";
    
    const msgTh = team && party
      ? `ℹ️ ไม่พบสมาชิกใน Team ${team.toUpperCase()} / Party ${party}`
      : team
      ? `ℹ️ ไม่พบสมาชิกใน Team ${team.toUpperCase()}`
      : "ℹ️ ยังไม่มีสมาชิกใน War Roster";
      
    await interaction.editReply({ content: `${msg}\n${msgTh}` });
    return;
  }

  const embeds: EmbedBuilder[] = [];
  
  for (const teamGroup of roster.teams) {
    let currentEmbed = new EmbedBuilder()
      .setTitle(`⚔️ Sunday War Roster - TEAM ${teamGroup.team}`)
      .setColor(0x0099FF);
    
    let description = "";
    for (const partyGroup of teamGroup.parties) {
      const partyLine = `**Party ${partyGroup.party}**\n`;
      const membersList = partyGroup.members.length > 0 
        ? partyGroup.members.map(m => `• ${m}`).join("\n") 
        : "• -";
      
      const chunk = `${partyLine}${membersList}\n\n`;
      
      if ((description.length + chunk.length) > 4000) {
        currentEmbed.setDescription(description);
        embeds.push(currentEmbed);
        currentEmbed = new EmbedBuilder()
          .setTitle(`⚔️ Sunday War Roster - TEAM ${teamGroup.team} (cont.)`)
          .setColor(0x0099FF);
        description = chunk;
      } else {
        description += chunk;
      }
    }
    
    currentEmbed.setDescription(description);
    embeds.push(currentEmbed);
  }

  if (embeds.length <= 10) {
    await interaction.editReply({ embeds });
  } else {
    await interaction.editReply({ embeds: embeds.slice(0, 10) });
    for (let i = 10; i < embeds.length; i += 10) {
      await interaction.followUp({ embeds: embeds.slice(i, i + 10) });
    }
  }
}
