import { createThemedStyles } from "@/theme/AppTheme";
import { Image, Pressable, Text, View } from "react-native";

import type { TimelineAttachment, TimelineEntry } from "@/lib/threadFormat";

import { normalizeImageUri } from "./utils";

type Props = {
  entry: TimelineEntry;
  onOpenAttachment: (attachment: TimelineAttachment) => void;
};

export function AttachmentGallery({ entry, onOpenAttachment }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.attachmentGallery}>
      {entry.attachments?.map((attachment, index) => (
        <Pressable key={`${attachment.uri.slice(0, 48)}:${index}`} onPress={() => onOpenAttachment(attachment)} style={styles.imageAttachmentWrap}>
          <Image resizeMode="cover" source={{ uri: normalizeImageUri(attachment.uri) }} style={styles.imageAttachment} />
          <Text style={styles.imageAttachmentLabel}>{attachment.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles({
  attachmentGallery: {
    gap: 8,
  },
  imageAttachmentWrap: {
    backgroundColor: "rgba(0, 0, 0, 0.12)",
    borderRadius: 12,
    height: 220,
    overflow: "hidden",
    width: 260,
  },
  imageAttachment: {
    height: 220,
    width: 260,
  },
  imageAttachmentLabel: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    bottom: 0,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
    left: 0,
    paddingHorizontal: 8,
    paddingVertical: 5,
    position: "absolute",
  },
});
